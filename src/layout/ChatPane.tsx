/* ChatPane — 流式消息 + 工具调用折叠 + 输入框 + 附件 + 停止按钮 + 回滚按钮
 * + console error 卡片
 *
 * 见 plan「UI 布局」+「Writing 蒙层期间 UI 锁定」节
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ChatController } from '../store/chat';
import type { Block, ChatMessage } from '../store/db';
import { Markdown } from '../components/Markdown';
import { ToolCallBlock } from '../components/ToolCallBlock';
import { AttachmentChip } from '../components/AttachmentChip';
import {
  type VisionImage,
  fileToVisionImage,
  isAcceptedImage,
} from '../attachments/vision';
import {
  getSnapshotForTurn,
  rollback,
  redo,
  getDryRun,
  hasSeenRollbackWarning,
  markRollbackWarningSeen,
  type DryRunFileDiff,
} from '../store/snapshots';
import { db } from '../store/db';
import type { Snapshot } from '../store/db';
import { isPinned, togglePin, emitPinnedChange, onPinnedChange } from '../store/pinned';
import {
  getBuffer,
  subscribe as subscribeBuffer,
  clearBuffer,
  setIdleFlushHandler,
  setInputFocused,
  type UserAction,
} from '../store/userActionBuffer';

export interface ChatPaneProps {
  controller: ChatController;
  /** 让 Settings 模态在 chat 内部触发(也可在 Header 触发,这里留口) */
  onOpenSettings: () => void;
}

export function ChatPane({ controller, onOpenSettings }: ChatPaneProps) {
  const state = useChatState(controller);
  const messages = useMessages(controller);
  const actionBuf = useActionBuffer();
  const [input, setInput] = useState('');
  const [images, setImages] = useState<VisionImage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, state.streamingMessageId]);

  // 5 秒静默自动发送 buffer
  useEffect(() => {
    setIdleFlushHandler(() => {
      // 调用时 sendUserText 内部会 flushBuffer 并发送
      void controller.sendUserText('');
    });
    return () => setIdleFlushHandler(null);
  }, [controller]);

  async function handleSubmit() {
    if (state.running) {
      controller.abort();
      return;
    }
    const text = input;
    setInput('');
    const imgs = images;
    setImages([]);
    await controller.sendUserText(text, { images: imgs });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f && isAcceptedImage(f)) {
          e.preventDefault();
          try {
            const img = await fileToVisionImage(f);
            setImages((prev) => prev.concat(img));
          } catch (_) {}
        }
      }
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) {
      if (isAcceptedImage(f)) {
        try {
          const img = await fileToVisionImage(f);
          setImages((prev) => prev.concat(img));
        } catch (_) {}
      }
    }
  }

  async function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'image/png,image/jpeg,image/gif,image/webp';
    inp.onchange = async () => {
      if (!inp.files) return;
      for (const f of Array.from(inp.files)) {
        if (isAcceptedImage(f)) {
          try {
            const img = await fileToVisionImage(f);
            setImages((prev) => prev.concat(img));
          } catch (_) {}
        }
      }
    };
    inp.click();
  }

  return (
    <div
      style={{
        width: 'var(--chat-w)',
        flex: '0 0 var(--chat-w)',
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--sp-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-3)',
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {messages.length === 0 && !state.streamingMessageId && (
          <EmptyHint onOpenSettings={onOpenSettings} />
        )}
        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            controller={controller}
            isStreaming={state.streamingMessageId === m.id && state.running}
            streamingBlocks={
              state.streamingMessageId === m.id
                ? controller.getStreamingBlocks()
                : null
            }
          />
        ))}

        {state.errorPrompt && (
          <ErrorPromptCard
            errors={state.errorPrompt.errors}
            onConfirm={() => controller.confirmErrorFix()}
            onDismiss={() => controller.dismissErrorPrompt()}
          />
        )}

        {/* 自查闭环进行中 — 微提示,3 秒后消失或转为新 turn */}
        {state.selfCheckActive && (
          <div
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(108, 201, 143, 0.08)',
              border: '1px solid var(--success)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--success)',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
            }}
          >
            <span>◌</span>
            <span>AI 自查中(3 秒)— 若发现 console error 会自动修一轮</span>
          </div>
        )}

        {/* 等待问卷 — 提示用户去 Questions tab */}
        {!state.running && state.pendingQuestions && (
          <div
            style={{
              padding: 'var(--sp-3)',
              border: '1px dashed var(--accent)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 164, 81, 0.08)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--accent)',
              lineHeight: 1.6,
              marginTop: 4,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              ⏸ AI 在等你填问卷
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              中栏顶部 → 点 <code style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 3 }}>Questions</code> tab 填表 → 提交后 AI 自动继续。
            </div>
          </div>
        )}

        {/* turn 已结束但既无问卷也无 errorPrompt — 提示空闲态 */}
        {!state.running &&
          !state.pendingQuestions &&
          !state.errorPrompt &&
          messages.length > 0 &&
          !messages[messages.length - 1].interrupted && (
            <div
              style={{
                padding: '4px 8px',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                textAlign: 'center',
                marginTop: 4,
              }}
            >
              ─ 本轮结束 · 继续输入下一条 ─
            </div>
          )}
      </div>

      {/* Input area */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: 'var(--sp-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'var(--bg-base)',
        }}
      >
        {actionBuf.length > 0 && (
          <ActionBufferPanel
            actions={actionBuf}
            onClear={() => clearBuffer()}
            onSendNow={() => controller.sendUserText('')}
          />
        )}
        {images.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginBottom: 4,
            }}
          >
            {images.map((img, i) => (
              <AttachmentChip
                key={i}
                img={img}
                onRemove={() =>
                  setImages((prev) => prev.filter((_, j) => j !== i))
                }
              />
            ))}
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder="Cmd/Ctrl + Enter 发送 — 试试问:做一个 SaaS 落地页"
          rows={3}
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-2)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-primary)',
            resize: 'none',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={pickFile}
            style={iconBtn}
            title="贴一张参考图给 AI 看"
          >
            📎
          </button>
          <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
            {state.running ? (
              <>
                {state.writing.currentFile
                  ? `writing ${state.writing.currentFile}`
                  : 'thinking…'}
              </>
            ) : (
              ''
            )}
          </span>
          <button
            onClick={handleSubmit}
            style={state.running ? btnStop : btnSend}
          >
            {state.running ? '⏹ 停止' : '↑ 发送'}
          </button>
        </div>
      </div>
    </div>
  );
}

// === message view ===

function MessageView({
  message,
  controller,
  isStreaming,
  streamingBlocks,
}: {
  message: ChatMessage;
  controller: ChatController;
  isStreaming: boolean;
  streamingBlocks: Block[] | null;
}) {
  const blocks = isStreaming && streamingBlocks ? streamingBlocks : message.blocks;
  const isUser = message.role === 'user';
  const turnId = message.turnId;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [dryRunOpen, setDryRunOpen] = useState(false);

  useEffect(() => {
    if (!turnId || message.role !== 'assistant') return;
    let cancelled = false;
    const refresh = async () => {
      const s = await db.snapshots
        .where({ projectId: controller.projectId, turnId })
        .first();
      if (!cancelled) setSnapshot(s ?? null);
    };
    refresh();
    return () => {
      cancelled = true;
    };
  }, [turnId, controller.projectId, message.role, message.interrupted]);

  async function handleRollback() {
    if (snapshot?.id == null) return;
    if (!(await hasSeenRollbackWarning())) {
      const ok = window.confirm(
        '回滚会撤销这一轮 AI 和你自己的所有改动,确认?\n(下次不再提示)'
      );
      if (!ok) return;
      await markRollbackWarningSeen();
    }
    await rollback(snapshot.id);
    controller.triggerRefresh();
    // refresh snapshot 状态(redoable)
    const s = await db.snapshots.get(snapshot.id);
    setSnapshot(s ?? null);
    setDryRunOpen(false);
  }

  async function handleRedo() {
    if (snapshot?.id == null) return;
    await redo(snapshot.id);
    controller.triggerRefresh();
    const s = await db.snapshots.get(snapshot.id);
    setSnapshot(s ?? null);
  }

  // 找配套 tool_result(下一条 user message 里 by tool_use_id)— 简化:不在 UI 里 join,UI 仅展示 input
  const toolUseIds = blocks
    .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => b.id);

  // 钉板状态(只对 assistant message + 有 text 内容的)
  const [pinned, setPinned] = useState(false);
  const canPin =
    !isUser &&
    !isStreaming &&
    message.id != null &&
    blocks.some((b) => b.type === 'text' && b.text.trim().length > 0);
  useEffect(() => {
    if (!canPin || message.id == null) return;
    let cancelled = false;
    isPinned(controller.projectId, message.id).then((p) => {
      if (!cancelled) setPinned(p);
    });
    const unsub = onPinnedChange((pid) => {
      if (pid !== controller.projectId || message.id == null) return;
      isPinned(controller.projectId, message.id).then((p) => {
        if (!cancelled) setPinned(p);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [canPin, message.id, controller.projectId]);

  async function handleTogglePin() {
    if (message.id == null) return;
    const next = await togglePin(controller.projectId, message.id);
    setPinned(next);
    emitPinnedChange(controller.projectId);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'stretch',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {isUser
          ? message.kind === 'console_errors'
            ? 'you · console errors'
            : message.kind === 'interrupt_marker'
            ? 'you · interrupted'
            : message.kind === 'summary'
            ? 'system · summary'
            : 'you'
          : 'ai'}
        {message.interrupted && ' · [中断]'}
      </div>
      <div
        style={{
          maxWidth: '100%',
          padding: isUser ? '8px 10px' : '8px 10px',
          background: isUser ? 'var(--bg-elevated)' : 'transparent',
          border: isUser ? '1px solid var(--border-subtle)' : 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.5,
          color: 'var(--text-primary)',
        }}
      >
        {blocks.map((b, i) => (
          <BlockView key={i} block={b} streaming={isStreaming} />
        ))}
        {!isUser && isStreaming && blocks.length === 0 && (
          <span style={{ color: 'var(--text-tertiary)' }}>…</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {!isStreaming && snapshot != null && (
          <RollbackControl
            snapshot={snapshot}
            dryRunOpen={dryRunOpen}
            setDryRunOpen={setDryRunOpen}
            onRollback={handleRollback}
            onRedo={handleRedo}
          />
        )}
        {canPin && (
          <button
            onClick={handleTogglePin}
            style={{
              fontSize: 'var(--fs-xs)',
              color: pinned ? 'var(--accent)' : 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              padding: 0,
            }}
            title={
              pinned
                ? '已钉到项目 brief。所有 chat 都会看到。点击取消'
                : '钉到项目 brief。后续所有 chat 启动时 AI 都会先收到这条作为上下文'
            }
          >
            {pinned ? '📌 已钉' : '📌 钉到项目'}
          </button>
        )}
      </div>

      {dryRunOpen && snapshot && (
        <DryRunPanel
          diffs={getDryRun(snapshot)}
          rolledBack={!!snapshot.rolledBack}
          onConfirm={snapshot.rolledBack ? handleRedo : handleRollback}
          onCancel={() => setDryRunOpen(false)}
        />
      )}
    </div>
  );
}

function RollbackControl({
  snapshot,
  dryRunOpen,
  setDryRunOpen,
  onRollback,
  onRedo,
}: {
  snapshot: Snapshot;
  dryRunOpen: boolean;
  setDryRunOpen: (v: boolean) => void;
  onRollback: () => void;
  onRedo: () => void;
}) {
  const fileCount = snapshot.diff.length;
  if (snapshot.rolledBack) {
    return (
      <button
        onClick={onRedo}
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono)',
        }}
        title={`已回滚。点击恢复这一轮的 ${fileCount} 个文件改动`}
      >
        ↷ 恢复此轮
      </button>
    );
  }
  return (
    <button
      onClick={() => setDryRunOpen(!dryRunOpen)}
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
      }}
      title={`查看会被还原的 ${fileCount} 个文件`}
    >
      {dryRunOpen ? '↶ 收起' : `↶ 回滚此轮 (${fileCount})`}
    </button>
  );
}

function DryRunPanel({
  diffs,
  rolledBack,
  onConfirm,
  onCancel,
}: {
  diffs: DryRunFileDiff[];
  rolledBack: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const actionLabel: Record<DryRunFileDiff['action'], string> = {
    created: '新建',
    modified: '修改',
    deleted: '删除',
  };
  const actionColor: Record<DryRunFileDiff['action'], string> = {
    created: 'var(--success)',
    modified: 'var(--accent)',
    deleted: 'var(--error)',
  };
  return (
    <div
      style={{
        marginTop: 4,
        padding: 'var(--sp-2) var(--sp-3)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
        本轮共 {diffs.length} 个文件改动 — 回滚会反转以下:
      </div>
      <div style={{ maxHeight: 140, overflow: 'auto', marginBottom: 6 }}>
        {diffs.map((d) => (
          <div
            key={d.path}
            style={{
              display: 'flex',
              gap: 8,
              padding: '1px 0',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ color: actionColor[d.action], width: 32 }}>
              {actionLabel[d.action]}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.path}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              {d.beforeLines} → {d.afterLines} 行
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ color: 'var(--text-tertiary)' }}>
          取消
        </button>
        <button
          onClick={onConfirm}
          style={{
            color: 'var(--accent)',
            fontWeight: 600,
          }}
        >
          {rolledBack ? '↷ 恢复' : '↶ 确认回滚'}
        </button>
      </div>
    </div>
  );
}

function BlockView({
  block,
  streaming,
}: {
  block: Block;
  streaming?: boolean;
}) {
  if (block.type === 'text') {
    return <Markdown text={block.text} />;
  }
  if (block.type === 'tool_use') {
    return (
      <ToolCallBlock
        name={block.name}
        input={block.input}
        streaming={streaming}
      />
    );
  }
  if (block.type === 'tool_result') {
    // tool_result 通常出现在 user message 里;UI 上简单处理
    return (
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          fontFamily: 'var(--font-mono)',
          color: block.is_error ? 'var(--error)' : 'var(--text-tertiary)',
          background: 'var(--bg-input)',
          padding: '4px 6px',
          borderRadius: 4,
          marginTop: 4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 120,
          overflow: 'auto',
        }}
      >
        {typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content, null, 2)}
      </div>
    );
  }
  if (block.type === 'image') {
    return (
      <img
        src={`data:${block.source.mediaType};base64,${block.source.data}`}
        alt=""
        style={{
          maxWidth: '100%',
          borderRadius: 'var(--radius-sm)',
          marginTop: 4,
        }}
      />
    );
  }
  return null;
}

// === error prompt card ===

function ErrorPromptCard({
  errors,
  onConfirm,
  onDismiss,
}: {
  errors: { message: string }[];
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--warning)',
        background: 'rgba(255, 204, 102, 0.08)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--sp-3)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          color: 'var(--warning)',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        ⚠ 预览有 {errors.length} 个 console error
      </div>
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          maxHeight: 80,
          overflow: 'auto',
          marginBottom: 6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {errors
          .slice(0, 5)
          .map((e, i) => `${i + 1}. ${e.message}`)
          .join('\n')}
        {errors.length > 5 && `\n…还有 ${errors.length - 5} 条`}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onConfirm} style={btnSendSmall}>
          让 AI 修复
        </button>
        <button onClick={onDismiss} style={btnSecondarySmall}>
          忽略
        </button>
      </div>
    </div>
  );
}

// === Empty hint ===

function EmptyHint({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div
      style={{
        margin: 'auto 0',
        padding: 'var(--sp-5) 0',
        textAlign: 'center',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--fs-sm)',
        lineHeight: 1.7,
      }}
    >
      <div style={{ marginBottom: 8 }}>试试问</div>
      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        "做一个 SaaS 落地页"
      </div>
      <div style={{ marginTop: 16, fontSize: 'var(--fs-xs)' }}>
        没设置 LLM?{' '}
        <button
          onClick={onOpenSettings}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            fontSize: 'var(--fs-xs)',
          }}
        >
          打开模型管理
        </button>
      </div>
    </div>
  );
}

// === ActionBufferPanel ===

function ActionBufferPanel({
  actions,
  onClear,
  onSendNow,
}: {
  actions: readonly UserAction[];
  onClear: () => void;
  onSendNow: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(255, 164, 81, 0.06)',
        padding: '6px 8px',
        marginBottom: 4,
        fontSize: 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 4,
          color: 'var(--accent)',
        }}
      >
        <span>动作 buffer ({actions.length}) — 5 秒静默自动发</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClear}
          style={{ color: 'var(--text-tertiary)', marginRight: 8 }}
        >
          清空
        </button>
        <button
          onClick={onSendNow}
          style={{
            color: 'var(--accent)',
            fontWeight: 600,
          }}
        >
          立即发送
        </button>
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {actions.slice(-5).map((a, i) => (
          <div
            key={i}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {actionLabel(a)}
          </div>
        ))}
        {actions.length > 5 && (
          <div style={{ color: 'var(--text-tertiary)' }}>
            …还有 {actions.length - 5} 条
          </div>
        )}
      </div>
    </div>
  );
}

function actionLabel(a: UserAction): string {
  if (a.kind === 'select_comment') {
    return `· #${a.aid} ${a.tagSnippet} 评论:${a.comment}`;
  }
  if (a.kind === 'inline_edit') {
    return `· [直改 #${a.aid}] "${a.before}" → "${a.after}"`;
  }
  if (a.kind === 'external_edit') {
    return `· [外部 ${a.changeKind}] ${a.path}`;
  }
  return `· [改 tweak ${a.tweakId}] ${a.before} → ${a.after}`;
}

// === Hooks ===

function useActionBuffer(): readonly UserAction[] {
  const [, force] = useState(0);
  useEffect(() => subscribeBuffer(() => force((v) => v + 1)), []);
  return getBuffer();
}

function useChatState(controller: ChatController) {
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getState()
  );
}

function useMessages(controller: ChatController) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await controller.loadMessages();
      if (!cancelled) setMessages(list);
    };
    refresh();
    const unsub = controller.subscribeMessages(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [controller]);
  return messages;
}

// === Styles ===

const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  fontSize: 14,
  color: 'var(--text-tertiary)',
};

const btnSend: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent)',
  color: '#1a1410',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
};

const btnStop: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--error)',
  color: '#fff',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
};

const btnSendSmall: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent)',
  color: '#1a1410',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
};

const btnSecondarySmall: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  border: '1px solid var(--border-default)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
};
