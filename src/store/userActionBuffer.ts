/* userActionBuffer — v1 占位 + v2 真接通
 *
 * 见 plan「用户动作 buffering」节
 *   - inspect/edit/Tweak 操作不立即触发 LLM 调用
 *   - 攒进 buffer,直到用户点"发送"或 5 秒静默后批量打包成一条 user message
 *
 * v1:实现 buffer 数据结构 + UI 留接口(没 UI 喂数据,所以始终为空)
 * v2:由 inspect / commentBubble 等模块 push 进来
 * v3:Tweak 改值也 push
 */

export type UserAction =
  | {
      kind: 'select_comment';
      aid: string;
      tagSnippet: string;            // "(button \"立即注册\")"
      comment: string;
    }
  | {
      kind: 'inline_edit';
      aid: string;
      before: string;
      after: string;
    }
  | {
      kind: 'tweak_change';
      tweakId: string;
      tweakType: string;
      before: string;
      after: string;
    };

const buffer: UserAction[] = [];
const listeners = new Set<() => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 5000;

export function pushAction(a: UserAction): void {
  buffer.push(a);
  scheduleIdleFlush();
  emit();
}

export function getBuffer(): readonly UserAction[] {
  return buffer;
}

export function clearBuffer(): void {
  buffer.length = 0;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  emit();
}

/** 把 buffer 转成发给 AI 的 user message text;不清空 */
export function formatBufferAsText(): string {
  if (buffer.length === 0) return '';
  const lines: string[] = ['用户操作汇总:'];
  for (const a of buffer) {
    if (a.kind === 'select_comment') {
      lines.push(`- 选中 #${a.aid} ${a.tagSnippet} 评论:${a.comment}`);
    } else if (a.kind === 'inline_edit') {
      lines.push(`- [直改 #${a.aid} 文本] "${a.before}" → "${a.after}"`);
    } else if (a.kind === 'tweak_change') {
      lines.push(
        `- [改 tweak ${a.tweakId} ${a.tweakType}] ${a.before} → ${a.after}`
      );
    }
  }
  return lines.join('\n');
}

/** 提交并清空,返回 text(供 chat.ts 拼到 user message);buffer 空时返回 '' */
export function flushBuffer(): string {
  const text = formatBufferAsText();
  clearBuffer();
  return text;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

let onIdleFlushFn: (() => void) | null = null;
export function setIdleFlushHandler(fn: (() => void) | null): void {
  onIdleFlushFn = fn;
}

function scheduleIdleFlush() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    onIdleFlushFn?.();
  }, IDLE_MS);
}
