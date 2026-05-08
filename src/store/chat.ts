/* 工具调用循环 + AbortController + turn-end 刷新 + snapshot
 *
 * 见 plan「工具循环 + 中断 + 上下文管理」+「Writing 蒙层期间 UI 锁定」节
 *
 * 核心约束:
 *   - 一个项目同时只能跑一个 turn
 *   - SDK 抛 AbortError → 标记中断、保留已写文件
 *   - 预览刷新只在 turn 结束 / done 工具时
 *   - done 触发后:不自动喂错误,显示"⚠ 要让 AI 修吗?[是][否]"卡片让用户决定
 */

import { db, type Block, type ChatMessage, type MessageKind } from './db';
import { nanoid } from 'nanoid';
import { startCapture, commitCapture } from './snapshots';
import { getRecentErrors, clearErrors } from '../preview/sandboxBridge';
import { maybeSummarize } from '../llm/contextManager';
import { ALL_TOOLS, executeTool, type ToolExecCtx } from '../llm/tools';
import {
  type QuestionSet,
  type QuestionAnswers,
  formatAnswers,
} from '../llm/questions';
import { loadPinnedMessages } from './pinned';
import { touchChat, getChatTask } from './chats';
import { getProjectBrief } from './projects';
import { formatProjectBrief, formatTaskBrief } from './briefs';
import type {
  ChatRequest,
  ChatResponse,
  Delta,
  LLMProvider,
  ProviderMessage,
} from '../llm/provider';
import { flushBuffer } from './userActionBuffer';

// === Public types ===

export interface WritingState {
  active: boolean;
  currentFile?: string;
}

export interface ErrorPrompt {
  errors: { message: string; ts: number }[];
}

export interface ChatState {
  running: boolean;
  writing: WritingState;
  refreshKey: number;            // PreviewPane 监听 +1 即刷
  errorPrompt: ErrorPrompt | null;
  /** 当前正在 streaming 的 assistant message id(未写入 DB,内存缓冲)*/
  streamingMessageId: number | null;
  /** AI 推上来的待回答问卷;非 null 时中栏切到 Questions tab */
  pendingQuestions: QuestionSet | null;
}

export interface SendOpts {
  /** 附带 vision 图(base64)*/
  images?: { mediaType: string; data: string }[];
}

// === ChatController per (project, chat) — v1.6 ===
// Map key = `${projectId}:${chatId}`
const controllers = new Map<string, ChatController>();

// 项目级互斥锁:同时只能一个 chat 在跑 turn
// key = projectId,value = chatId(正在跑)
const projectLocks = new Map<number, number>();

export function getChatController(
  projectId: number,
  chatId: number,
  provider: () => LLMProvider | null
): ChatController {
  const key = `${projectId}:${chatId}`;
  let c = controllers.get(key);
  if (!c) {
    c = new ChatController(projectId, chatId, provider);
    controllers.set(key, c);
  } else {
    c.updateProviderResolver(provider);
  }
  return c;
}

/** 同一项目其他 chat 正在跑 turn? */
export function isProjectBusyExcept(
  projectId: number,
  chatId: number
): boolean {
  const running = projectLocks.get(projectId);
  return running != null && running !== chatId;
}

export function getRunningChatId(projectId: number): number | null {
  return projectLocks.get(projectId) ?? null;
}

const lockListeners = new Set<(projectId: number) => void>();
export function onProjectLockChange(
  fn: (projectId: number) => void
): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}
function emitLock(projectId: number) {
  for (const fn of lockListeners) fn(projectId);
}

export class ChatController {
  private state: ChatState = {
    running: false,
    writing: { active: false },
    refreshKey: 0,
    errorPrompt: null,
    streamingMessageId: null,
    pendingQuestions: null,
  };

  private listeners = new Set<(s: ChatState) => void>();
  private msgListeners = new Set<() => void>();
  private currentAbort: AbortController | null = null;
  private streamingBlocks: Block[] = [];

  constructor(
    public readonly projectId: number,
    public readonly chatId: number,
    private resolveProvider: () => LLMProvider | null
  ) {}

  updateProviderResolver(fn: () => LLMProvider | null) {
    this.resolveProvider = fn;
  }

  // === Subscribe ===
  getState(): ChatState {
    return this.state;
  }
  subscribe(fn: (s: ChatState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  subscribeMessages(fn: () => void): () => void {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }
  private emit() {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }
  private emitMsgs() {
    for (const fn of this.msgListeners) fn();
  }
  private patch(p: Partial<ChatState>) {
    this.state = { ...this.state, ...p };
    this.emit();
  }

  // === Public actions ===

  /** 用户在 chat 框发送文本(可附带 vision 图)。也会自动 flush userActionBuffer 拼在前面 */
  async sendUserText(text: string, opts: SendOpts = {}): Promise<void> {
    if (this.state.running) return;     // 不允许并发
    const provider = this.resolveProvider();
    if (!provider) {
      await this.appendUserError('未配置 LLM 模型,先去右上角"设置"配置 provider 和 API key。');
      return;
    }

    const buf = flushBuffer();
    const fullText = buf ? `${buf}\n\n${text}`.trim() : text.trim();
    if (!fullText && !opts.images?.length) return;

    const blocks: Block[] = [];
    if (fullText) blocks.push({ type: 'text', text: fullText });
    if (opts.images?.length) {
      for (const img of opts.images) {
        blocks.push({
          type: 'image',
          source: { mediaType: img.mediaType, data: img.data },
        });
      }
    }

    await this.appendMessage('user', blocks, { kind: 'chat' });
    await this.runTurn();
  }

  /** 用户点"修复"按钮:把 console errors 拼成消息发出 */
  async confirmErrorFix(): Promise<void> {
    if (this.state.running) return;
    const ep = this.state.errorPrompt;
    if (!ep) return;
    this.patch({ errorPrompt: null });
    const text = ep.errors
      .map((e, i) => `${i + 1}. ${e.message}`)
      .join('\n');
    await this.appendMessage(
      'user',
      [
        {
          type: 'text',
          text: `预览中出现以下 console error,请修复:\n${text}`,
        },
      ],
      { kind: 'console_errors' }
    );
    clearErrors(this.projectId);
    await this.runTurn();
  }

  dismissErrorPrompt(): void {
    this.patch({ errorPrompt: null });
    clearErrors(this.projectId);
  }

  abort(): void {
    if (!this.state.running) return;
    this.currentAbort?.abort();
  }

  triggerRefresh(): void {
    this.patch({ refreshKey: this.state.refreshKey + 1 });
  }

  /** 用户提交问卷答案 → 拼成 user message 触发新 turn */
  async submitQuestionAnswers(answers: QuestionAnswers): Promise<void> {
    if (this.state.running) return;
    const set = this.state.pendingQuestions;
    if (!set) return;
    const text = formatAnswers(set, answers);
    this.patch({ pendingQuestions: null });
    await this.appendMessage(
      'user',
      [{ type: 'text', text }],
      { kind: 'chat' }
    );
    await this.runTurn();
  }

  /** 用户取消问卷(关闭不提交) */
  cancelPendingQuestions(): void {
    this.patch({ pendingQuestions: null });
  }

  // === DB helpers ===

  async loadMessages(): Promise<ChatMessage[]> {
    return db.messages
      .where('chatId')
      .equals(this.chatId)
      .sortBy('createdAt');
  }

  private async appendMessage(
    role: 'user' | 'assistant',
    blocks: Block[],
    extras: { kind?: MessageKind; turnId?: string; interrupted?: boolean } = {}
  ): Promise<number> {
    const id = await db.messages.add({
      projectId: this.projectId,
      chatId: this.chatId,
      role,
      blocks,
      kind: extras.kind,
      turnId: extras.turnId,
      interrupted: extras.interrupted,
      createdAt: Date.now(),
    });
    // 写入 message 时刷新 chat 的 updatedAt(列表按它排序)
    void touchChat(this.chatId);
    this.emitMsgs();
    return id as number;
  }

  private async updateMessage(
    id: number,
    patch: Partial<ChatMessage>
  ): Promise<void> {
    await db.messages.update(id, patch);
    this.emitMsgs();
  }

  private async appendUserError(text: string) {
    await this.appendMessage('user', [
      { type: 'text', text: `⚠ ${text}` },
    ]);
  }

  // === Provider message construction ===

  private async buildProviderMessages(): Promise<ProviderMessage[]> {
    const out: ProviderMessage[] = [];

    // === 三层 brief 拼成一条 user message 放最前 ===
    const briefSections: string[] = [];

    // (a) 项目级背景(填一次,所有 chat 共享)
    const projectBrief = await getProjectBrief(this.projectId);
    const projectBriefText = formatProjectBrief(projectBrief);
    if (projectBriefText) briefSections.push(projectBriefText);

    // (b) 本任务背景(每个 chat 创建时填)
    const taskBrief = await getChatTask(this.chatId);
    const taskBriefText = formatTaskBrief(taskBrief);
    if (taskBriefText) briefSections.push(taskBriefText);

    // (c) 钉板:用户主动钉的关键决策(动态)
    const pinned = await loadPinnedMessages(this.projectId);
    if (pinned.length > 0) {
      const pinnedText = formatPinnedAsBrief(pinned);
      if (pinnedText) briefSections.push(pinnedText);
    }

    if (briefSections.length > 0) {
      out.push({
        role: 'user',
        blocks: [{ type: 'text', text: briefSections.join('\n\n') }],
      });
    }

    // === 当前 chat 历史 ===
    const all = await this.loadMessages();
    for (const m of all) {
      out.push({ role: m.role, blocks: m.blocks });
    }
    return out;
  }

  // === The turn loop ===

  private async runTurn(): Promise<void> {
    const provider = this.resolveProvider();
    if (!provider) return;

    // 项目级互斥锁:其他 chat 正在跑就拒绝
    const otherRunning = projectLocks.get(this.projectId);
    if (otherRunning != null && otherRunning !== this.chatId) {
      await this.appendUserError(
        `项目内另一个 chat 正在运行 turn(chatId=${otherRunning})。等它结束或停止它。`
      );
      return;
    }
    projectLocks.set(this.projectId, this.chatId);
    emitLock(this.projectId);

    const turnId = nanoid(10);
    await startCapture(this.projectId, turnId);

    this.currentAbort = new AbortController();
    this.streamingBlocks = [];
    this.patch({
      running: true,
      writing: { active: true },
      errorPrompt: null,
      streamingMessageId: null,
    });

    let interruptedByAbort = false;
    let pendingAssistantId: number | null = null;
    let doneCalled = false;

    const onWriteStart = (path: string) => {
      this.patch({ writing: { active: true, currentFile: path } });
    };
    const onShow = (path: string) => {
      // 通知 PreviewPane 切到指定文件(variant 入口或 root index.html)
      void import('../preview/showSignal').then(({ emitShow }) =>
        emitShow(this.projectId, path)
      );
    };
    const onDone = (_summary: string) => {
      doneCalled = true;
    };
    const onAskQuestions = (set: QuestionSet) => {
      this.patch({ pendingQuestions: set });
    };

    try {
      let safetyCounter = 0;
      while (true) {
        if (safetyCounter++ > 30) {
          // 防 LLM 死循环调工具(理论上 stopReason!='tool_use' 应已退出)
          break;
        }

        if (this.currentAbort.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // 构建本轮 messages(可能 summarize)
        let messages = await this.buildProviderMessages();
        messages = await maybeSummarize(messages, {
          summarize: (oldMsgs) => this.summarizeOld(provider, oldMsgs),
        });

        // 起一条 streaming assistant message(空 blocks,等流式 fill)
        pendingAssistantId = await this.appendMessage('assistant', [], {
          turnId,
        });
        this.patch({ streamingMessageId: pendingAssistantId });

        const onDelta = (d: Delta) => {
          this.applyDelta(d, pendingAssistantId!);
        };

        const req: ChatRequest = {
          messages,
          tools: ALL_TOOLS,
          signal: this.currentAbort.signal,
          onDelta,
        };

        if (typeof window !== 'undefined') {
          // eslint-disable-next-line no-console
          console.groupCollapsed(
            `[chat→server] ${messages.length} msgs · ${ALL_TOOLS.length} tools`
          );
          console.log('TOOLS:', ALL_TOOLS.map((t) => t.name).join(', '));
          console.log('MESSAGES:', messages);
          console.groupEnd();
        }

        let resp: ChatResponse;
        try {
          resp = await provider.chat(req);
        } catch (err) {
          if (isAbortErr(err)) {
            interruptedByAbort = true;
            // 标记当前 streaming message 为中断,保存已 stream 的 blocks
            await this.updateMessage(pendingAssistantId, {
              blocks: this.streamingBlocks,
              interrupted: true,
            });
            break;
          }
          // 真实错误:写一条 error message,break
          await this.updateMessage(pendingAssistantId, {
            blocks: [
              {
                type: 'text',
                text: `⚠ 调用 LLM 失败: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              },
            ],
          });
          break;
        }

        // 用 final blocks 覆盖 streaming buffer(authoritative)
        await this.updateMessage(pendingAssistantId, { blocks: resp.blocks });
        this.streamingBlocks = resp.blocks;

        // === max_tokens 截断 → 自动续写一次 ===
        if (resp.stopReason === 'max_tokens') {
          // 当前 assistant message 标记被截
          const cur = await db.messages.get(pendingAssistantId);
          const stamped = [
            ...(cur?.blocks ?? []),
            {
              type: 'text',
              text: '\n\n[…触发 max_tokens 截断,自动续写中]',
            } as const,
          ];
          await this.updateMessage(pendingAssistantId, { blocks: stamped });
          // 追加一条 system 风格 user message 让模型继续
          await this.appendMessage(
            'user',
            [{ type: 'text', text: '继续上一步未完成的工作。直接接着写,不要重复。' }],
            { kind: 'chat' }
          );
          this.streamingBlocks = [];
          continue;
        }

        if (resp.stopReason !== 'tool_use') {
          break;
        }

        // 执行所有 tool_use blocks
        const toolUses = resp.blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> =>
          b.type === 'tool_use'
        );
        if (toolUses.length === 0) break;

        const toolResults: Block[] = [];
        const ctx: ToolExecCtx = {
          projectId: this.projectId,
          signal: this.currentAbort.signal,
          onWriteStart,
          onShow,
          onDone,
          onAskQuestions,
        };
        for (const t of toolUses) {
          if (this.currentAbort.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          let result;
          try {
            // 把当前 tool_use_id 灌进 ctx 给 ask_questions 用
            const callCtx: ToolExecCtx = { ...ctx, toolUseId: t.id };
            result = await executeTool(t.name, t.input, callCtx);
          } catch (e) {
            if (isAbortErr(e)) throw e;
            result = {
              content: `tool error: ${e instanceof Error ? e.message : String(e)}`,
              is_error: true,
            };
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: result.content,
            is_error: result.is_error,
          });
        }

        // 喂 tool_result 作为下一轮 user message
        await this.appendMessage('user', toolResults);

        // 清掉 currentFile 提示
        this.patch({ writing: { active: true, currentFile: undefined } });

        if (doneCalled) break;

        // 如果 ask_questions 已推上 UI,本轮不必继续 — 等用户提交
        if (this.state.pendingQuestions) break;
      }
    } catch (err) {
      if (isAbortErr(err)) {
        interruptedByAbort = true;
        if (pendingAssistantId != null) {
          await this.updateMessage(pendingAssistantId, {
            blocks: this.streamingBlocks,
            interrupted: true,
          });
        }
      } else {
        console.error('[chat] turn error', err);
      }
    } finally {
      // 中断标记
      if (interruptedByAbort) {
        await this.appendMessage(
          'user',
          [{ type: 'text', text: '[用户中断]' }],
          { kind: 'interrupt_marker' }
        );
      }

      // commit snapshot(关联到当前 chat)
      try {
        await commitCapture(turnId, this.chatId);
      } catch (e) {
        console.warn('[chat] snapshot commit failed', e);
      }

      // 释放项目锁
      if (projectLocks.get(this.projectId) === this.chatId) {
        projectLocks.delete(this.projectId);
        emitLock(this.projectId);
      }

      // 退出 writing,刷一次预览
      this.patch({
        running: false,
        writing: { active: false },
        streamingMessageId: null,
        refreshKey: this.state.refreshKey + 1,
      });
      this.currentAbort = null;

      // done 后查 console errors,展示卡片(不自动喂)
      if (doneCalled) {
        // 给 iframe 重载一点时间再抓 errors
        setTimeout(() => {
          const errs = getRecentErrors(this.projectId, 5000);
          if (errs.length > 0) {
            this.patch({
              errorPrompt: { errors: errs.slice(-10) },
            });
          }
        }, 800);
      }
    }
  }

  /** 把流式 delta 投到 streamingBlocks(仅用于显示;最终以 final.blocks 为准) */
  private applyDelta(d: Delta, _msgId: number) {
    if (d.type === 'text') {
      const last = this.streamingBlocks[this.streamingBlocks.length - 1];
      if (last && last.type === 'text') {
        last.text += d.text;
      } else {
        this.streamingBlocks.push({ type: 'text', text: d.text });
      }
      // 通过 emitMsgs 通知 UI(虽然 DB 还没写;UI 可读 streaming buffer)
      this.emitMsgs();
    } else if (d.type === 'tool_call_start') {
      this.streamingBlocks.push({
        type: 'tool_use',
        id: d.id,
        name: d.name,
        input: {},
      });
      this.emitMsgs();
    }
    // arg_delta / end 不更新 streamingBlocks(input 在 final 时一次性给)
  }

  /** 当前 streaming buffer(给 ChatPane 实时显示) */
  getStreamingBlocks(): Block[] {
    return this.streamingBlocks;
  }

  /** v1.5 简化:本地拼接掐头摘要,不再额外调一次 LLM
   *  (后端拥有 system prompt;额外的 summarize 调用要单独后端端点,留给后续) */
  private async summarizeOld(
    _provider: LLMProvider,
    old: ProviderMessage[]
  ): Promise<string> {
    const lines = old.slice(-30).map((m) => {
      const t = m.blocks
        .map((b) => {
          if (b.type === 'text') return b.text.slice(0, 200);
          if (b.type === 'tool_use') return `[tool ${b.name}]`;
          if (b.type === 'tool_result') {
            const c = typeof b.content === 'string' ? b.content : '[blocks]';
            return `[tool_result] ${c.slice(0, 100)}`;
          }
          if (b.type === 'image') return '[image]';
          return '';
        })
        .filter(Boolean)
        .join(' / ');
      return `${m.role.toUpperCase()}: ${t}`;
    });
    return `(早期对话已截断;最近 ${lines.length} 条片段)\n${lines.join('\n')}`;
  }
}

/** 把项目钉板内容拼成一段 brief 文本(放在新 chat 的 messages 最前) */
function formatPinnedAsBrief(pinned: ChatMessage[]): string {
  const lines: string[] = [
    '[项目级 brief — 以下是用户钉到项目的关键决策,所有 chat 共享。请严格遵循:]',
    '',
  ];
  for (const m of pinned) {
    for (const b of m.blocks) {
      if (b.type === 'text' && b.text) {
        lines.push(b.text.trim());
        lines.push('');
      }
    }
  }
  return lines.join('\n').trim();
}

function isAbortErr(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (e && typeof e === 'object' && 'name' in e && (e as any).name === 'AbortError')
    return true;
  return false;
}
