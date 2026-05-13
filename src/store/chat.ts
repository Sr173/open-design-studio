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
  type Question,
  formatAnswers,
} from '../llm/questions';
import { tryParseAskQuestionsPartial } from '../llm/streamingParse';
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

export interface TodoItem {
  /** 稳定 id,AI 用它 update */
  id: string;
  /** 命令式表述 — 列表显示用 */
  content: string;
  /** 现在进行时 — 状态为 in_progress 时高亮显示 */
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
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
  /** v6.0g:ask_questions 流式期间的"半成品"问卷 — 每解析出一题就更新一次,
   *  让用户看到 "AI 正在挑问题" 的过程,不是一下蹦出 5 题。
   *  pendingQuestions 一旦 set,这个清空 */
  streamingQuestions: {
    toolUseId: string;
    title: string;
    questions: Question[];
  } | null;
  /** v1.8.1:自查闭环触发中(static-check 周期内) — chat 顶 banner 显示 */
  selfCheckActive: boolean;
  /** v6.1:AI 用 todo_write 维护的当前 chat 的多步任务清单 */
  todos: TodoItem[];
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
    streamingQuestions: null,
    selfCheckActive: false,
    todos: [],
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

    // 用户手动开始新一轮 → 重置自查 retry cap
    await db.chats.update(this.chatId, { autoFixRetries: 0 });

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

  /** 用户点"修复"按钮:把 console errors 去重 + 截断 + 拼成消息发出 */
  async confirmErrorFix(): Promise<void> {
    if (this.state.running) return;
    const ep = this.state.errorPrompt;
    if (!ep) return;
    this.patch({ errorPrompt: null });

    // 去重(连续相同 message 合并)+ 截断(每条 stack 超 500 字符截掉中间)
    const deduped = dedupeAndTruncateErrors(ep.errors);

    // 累计 chat.autoFixRetries(用户看得到"已自动修 N 次")
    const chat = await db.chats.get(this.chatId);
    const next = (chat?.autoFixRetries ?? 0) + 1;
    await db.chats.update(this.chatId, { autoFixRetries: next });

    const text = deduped
      .map((e, i) => `${i + 1}. ${e.message}`)
      .join('\n');
    const retryNote =
      next > 1
        ? `\n\n(这是本任务第 ${next} 次让 AI 修 console error。如果上次没修好,这次重点检查那些没解决的项,而不是又改一遍同样的代码。)`
        : '';

    await this.appendMessage(
      'user',
      [
        {
          type: 'text',
          text: `预览中出现以下 console error,请修复:\n${text}${retryNote}`,
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
      // 真问卷上来 → 清掉 streaming 半成品(数据相同,避免双重渲染)
      this.patch({ pendingQuestions: set, streamingQuestions: null });
    };
    const onTodoUpdate = (todos: TodoItem[]) => {
      this.patch({ todos });
    };

    try {
      let safetyCounter = 0;
      const SAFETY_CAP = 50; // 复杂多变体任务:shared + 3 variants × (read + write) + ask_questions + done = ~10,留 5×余量
      while (true) {
        if (safetyCounter++ > SAFETY_CAP) {
          // 喂一条 user message 告知 AI 单轮上限,后续在下一轮接着干
          await this.appendMessage(
            'user',
            [
              {
                type: 'text',
                text: `[系统] 单轮已调用 ${SAFETY_CAP} 个工具,达到上限。本轮强制结束 — 你的进度已经保存,用户发"继续"会接着做。`,
              },
            ],
            { kind: 'chat' }
          );
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
            // **关键**:剥掉所有 orphan tool_use(没机会执行),只保留 text。
            // 不剥的话,下次提交 history 给 Anthropic 会因孤儿 tool_use 报 400。
            const cleaned = this.streamingBlocks.filter(
              (b) => b.type !== 'tool_use'
            );
            await this.updateMessage(pendingAssistantId, {
              blocks: cleaned.length
                ? cleaned
                : [{ type: 'text', text: '[中断 — AI 当时在调工具,内容已丢弃]' }],
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

        const ctx: ToolExecCtx = {
          projectId: this.projectId,
          signal: this.currentAbort.signal,
          onWriteStart,
          onShow,
          onDone,
          onAskQuestions,
          onTodoUpdate,
        };

        // 并行化:read_file / list_files / get_element_info 这种**纯查询**可并发;
        // write_file / delete_file / replace_element_text / show_to_user / done / ask_questions 改状态/触发 UI,必须串行(否则顺序敏感、UI flicker)
        const READ_ONLY = new Set([
          'read_file',
          'list_files',
          'get_element_info',
          'read_source_file',
          'list_source_files',
          'search_files',
        ]);

        // 关键不变量:tool_result 顺序必须跟 tool_use 一致(Anthropic / OpenAI 协议)
        // 实现:把每个 tool_use 包成 promise,按原 index 收集结果。但相邻的写工具
        // 之间要 await(创建一个 chain),read 类可挂任意 chain 点上并行。
        const results: Array<{ idx: number; block: Block } | null> = new Array(
          toolUses.length
        ).fill(null);
        let writeChain: Promise<void> = Promise.resolve();
        const runs: Promise<void>[] = [];

        for (let i = 0; i < toolUses.length; i++) {
          const t = toolUses[i];
          const isRead = READ_ONLY.has(t.name);
          const callCtx: ToolExecCtx = { ...ctx, toolUseId: t.id };
          const exec = async () => {
            if (this.currentAbort!.signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            let result;
            try {
              result = await executeTool(t.name, t.input, callCtx);
            } catch (e) {
              if (isAbortErr(e)) throw e;
              result = {
                content: `tool error: ${
                  e instanceof Error ? e.message : String(e)
                }`,
                is_error: true,
              };
            }
            results[i] = {
              idx: i,
              block: {
                type: 'tool_result',
                tool_use_id: t.id,
                content: result.content,
                is_error: result.is_error,
              },
            };
          };
          if (isRead) {
            // read 类不阻塞 write 链
            runs.push(exec());
          } else {
            // write 类:接在 write chain 后,串行执行
            writeChain = writeChain.then(exec);
            runs.push(writeChain);
          }
        }
        await Promise.all(runs);

        const toolResults: Block[] = results
          .filter((r): r is { idx: number; block: Block } => r != null)
          .map((r) => r.block);

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
          // 关键:中断时若 assistant 写了 tool_use 但工具循环没机会 push 对应 tool_result,
          // 下次发回 LLM 会因孤儿 tool_use 报错。这里**剥掉所有 tool_use**,只留 text
          // (server 端 dropOrphanServerToolUses 还有一道兜底,但本地干净最稳)
          const cleaned = this.streamingBlocks.filter(
            (b) => b.type !== 'tool_use'
          );
          await this.updateMessage(pendingAssistantId, {
            blocks: cleaned.length
              ? cleaned
              : [{ type: 'text', text: '[中断 — AI 当时在调工具,内容已丢弃]' }],
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

      // 退出 writing,刷一次预览。若 streamingQuestions 仍残留(中断/lint 失败),清掉
      this.patch({
        running: false,
        writing: { active: false },
        streamingMessageId: null,
        refreshKey: this.state.refreshKey + 1,
        streamingQuestions: this.state.pendingQuestions ? null : null,
      });
      this.activeAskBuf = null;
      this.currentAbort = null;

      // === done 后自查闭环 ===
      if (doneCalled) {
        clearErrors(this.projectId);
        this.patch({ selfCheckActive: true });
        setTimeout(async () => {
          // 自查窗口结束 — 不论是否触发新 turn,都先把 banner 摘掉
          // (新 turn 起来后 running 会接管 UI 状态)
          this.patch({ selfCheckActive: false });

          // 防御:用户切走 / 删 chat / 锁被别人拿了 → 静默放弃自查
          const chatStillExists = await db.chats.get(this.chatId);
          if (!chatStillExists) {
            console.log('[chat] selfCheck skipped: chat deleted');
            return;
          }
          const lockHolder = projectLocks.get(this.projectId);
          if (lockHolder != null && lockHolder !== this.chatId) {
            console.log('[chat] selfCheck skipped: another chat holds lock');
            return;
          }

          const errs = getRecentErrors(this.projectId, 5000);
          if (errs.length === 0) return;
          const dedup = dedupeAndTruncateErrors(errs).slice(-10);
          const retries = chatStillExists.autoFixRetries ?? 0;

          if (retries < 1) {
            await db.chats.update(this.chatId, { autoFixRetries: retries + 1 });
            const lines = dedup
              .map((e, i) => `${i + 1}. ${e.message}`)
              .join('\n');
            await this.appendMessage(
              'user',
              [
                {
                  type: 'text',
                  text:
                    '[自查闭环] 预览刚才报了以下 console error,在 done 之前请补改一次 ' +
                    '(只允许一次自动修;若改完还出错,会让用户决定):\n' +
                    lines,
                },
              ],
              { kind: 'console_errors' }
            );
            clearErrors(this.projectId);
            await this.runTurn();
          } else {
            this.patch({ errorPrompt: { errors: dedup } });
          }
        }, 3000);
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
      // 流式 ask_questions:开个 buffer,逐字符喂
      if (d.name === 'ask_questions') {
        this.activeAskBuf = { id: d.id, buffer: '' };
        this.patch({
          streamingQuestions: { toolUseId: d.id, title: '加载中…', questions: [] },
        });
      }
      this.emitMsgs();
    } else if (d.type === 'tool_call_args') {
      // 累积 ask_questions args,边累边解析,新增 question 就 emit
      if (this.activeAskBuf && this.activeAskBuf.id === d.id) {
        this.activeAskBuf.buffer += d.chunk;
        const partial = tryParseAskQuestionsPartial(this.activeAskBuf.buffer);
        const prev = this.state.streamingQuestions;
        // 只在题数 / title 真有变化时更新(避免高频 patch)
        const titleChanged =
          (partial.title ?? '') !== (prev?.title ?? '');
        const lenChanged =
          partial.questions.length !== (prev?.questions.length ?? 0);
        if (titleChanged || lenChanged) {
          this.patch({
            streamingQuestions: {
              toolUseId: d.id,
              title: partial.title ?? '加载中…',
              questions: partial.questions,
            },
          });
        }
      }
    } else if (d.type === 'tool_call_end') {
      if (this.activeAskBuf && this.activeAskBuf.id === d.id) {
        this.activeAskBuf = null;
      }
    }
  }

  /** 流式 ask_questions 的当前 buffer */
  private activeAskBuf: { id: string; buffer: string } | null = null;

  /** 当前 streaming buffer(给 ChatPane 实时显示) */
  getStreamingBlocks(): Block[] {
    return this.streamingBlocks;
  }

  /** 本地摘要(无 LLM 二次调用):
   *  - **所有 user message 全保留**(可能含用户钉过的决策 / 重要指令)
   *  - assistant message 中只 keep tool_use 调用清单 + 摘掉 long text
   *  - tool_result 摘短 */
  private async summarizeOld(
    _provider: LLMProvider,
    old: ProviderMessage[]
  ): Promise<string> {
    const lines: string[] = [];
    for (const m of old) {
      if (m.role === 'user') {
        // 全文保留 user message 文本(可能含决策 / kind='chat' 等)
        const text = m.blocks
          .map((b) => {
            if (b.type === 'text') return b.text;
            if (b.type === 'tool_result') {
              const c = typeof b.content === 'string' ? b.content : '[blocks]';
              return `[tool_result] ${c.slice(0, 200)}`;
            }
            if (b.type === 'image') return '[image]';
            return '';
          })
          .filter(Boolean)
          .join(' / ');
        if (text) lines.push(`USER: ${text}`);
      } else {
        // assistant:摘 text 头 300 字符 + 列 tool_use 调用清单
        const parts: string[] = [];
        for (const b of m.blocks) {
          if (b.type === 'text' && b.text) parts.push(b.text.slice(0, 300));
          if (b.type === 'tool_use')
            parts.push(`[tool ${b.name}](${tryJsonHead(b.input)})`);
        }
        if (parts.length) lines.push(`AI: ${parts.join(' · ')}`);
      }
    }
    return `[历史摘要 — user 消息全保留,AI 输出截断]\n${lines.join('\n')}`;
  }
}

function tryJsonHead(input: unknown): string {
  try {
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return '...';
  }
}

/** 错误去重:指纹 = 头 80 字符(分类) + 尾 50 字符(定位)+ 长度
 *  React 类错误前缀长一致,具体组件名在尾;这种指纹保留区分度
 */
function dedupeAndTruncateErrors(
  errors: { message: string; ts: number }[]
): { message: string; ts: number }[] {
  const seen = new Map<
    string,
    { message: string; ts: number; count: number }
  >();
  for (const e of errors) {
    const msg = e.message;
    const head = msg.slice(0, 80);
    const tail = msg.length > 130 ? msg.slice(-50) : '';
    const key = `${head}|${tail}|${msg.length}`;
    const exist = seen.get(key);
    if (exist) {
      exist.count += 1;
      if (e.ts > exist.ts) exist.ts = e.ts;
    } else {
      seen.set(key, {
        message: truncateMid(msg, 500),
        ts: e.ts,
        count: 1,
      });
    }
  }
  return Array.from(seen.values()).map(({ message, ts, count }) => ({
    message: count > 1 ? `${message}  (×${count})` : message,
    ts,
  }));
}

function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  const tail = max - head - 8;
  return `${s.slice(0, head)}…[truncated]…${s.slice(-tail)}`;
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
