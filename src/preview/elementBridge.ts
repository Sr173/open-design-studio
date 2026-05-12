/* 元素 bridge — host ↔ iframe 关于 mode + 选中状态的协调
 *
 * - 维护 host 端的 mode 状态(preview/inspect/comment/edit)
 * - 把 mode 推给 iframe
 * - 监听 iframe 的 select / comment_target / inline_edit 事件
 * - 入 userActionBuffer(commentBubble 的提交逻辑会拼装文本)
 * - 暴露 useElementBridge hook
 *
 * v2 文件,Sprint 1 占位。
 */

import { onPreviewMessage, type ElementInfo } from './sandboxBridge';
import { pushAction } from '../store/userActionBuffer';

export type PreviewMode = 'preview' | 'inspect' | 'comment' | 'edit';

interface BridgeState {
  mode: PreviewMode;
  selection: ElementInfo | null;
  /** 用户在 comment 模式选中后等待写评论的元素 */
  pendingComment: ElementInfo | null;
}

class ElementBridge {
  private state: BridgeState = {
    mode: 'preview',
    selection: null,
    pendingComment: null,
  };
  private listeners = new Set<(s: BridgeState) => void>();
  private unsubMessage: (() => void) | null = null;
  /** 所有挂到 bridge 的 iframe — 单变体只挂 1 个,canvas 模式挂 N 个 */
  private iframes = new Set<HTMLIFrameElement>();

  constructor(public readonly projectId: number) {
    this.unsubMessage = onPreviewMessage(projectId, (msg) => {
      if (msg.type === 'select') {
        this.patch({ selection: msg.info });
      } else if (msg.type === 'comment_target') {
        this.patch({ pendingComment: msg.info });
      } else if (msg.type === 'inline_edit') {
        // 直改:发到 inlineEdit 模块去回写源码 + push action
        // (inlineEdit 模块挂在外层,这里只 push action 让 AI 知道)
        pushAction({
          kind: 'inline_edit',
          aid: msg.aid,
          before: msg.before,
          after: msg.after,
        });
        // inlineEdit 模块会另外订阅同一消息把改动回写到源码
      } else if (msg.type === 'ready') {
        // iframe 重载后重新推一次 mode(给所有挂着的 iframe)
        if (this.state.mode !== 'preview') {
          this.broadcast(this.state.mode);
        }
      }
    });
  }

  /** 挂一个 iframe;返回 detach 函数。多变体 canvas 模式下会有 2-4 个同时挂着 */
  attachIframe(iframe: HTMLIFrameElement | null): () => void {
    if (!iframe) return () => {};
    this.iframes.add(iframe);
    if (this.state.mode !== 'preview') {
      this.postTo(iframe, { type: 'set_mode', mode: this.state.mode });
    }
    return () => {
      this.iframes.delete(iframe);
    };
  }

  setMode(mode: PreviewMode) {
    this.patch({ mode, selection: null, pendingComment: null });
    this.broadcast(mode);
  }

  clearSelection() {
    for (const f of this.iframes) {
      this.postTo(f, { type: 'clear_selection' });
    }
    this.patch({ selection: null, pendingComment: null });
  }

  submitComment(text: string) {
    const t = this.state.pendingComment;
    if (!t || !text.trim()) {
      this.patch({ pendingComment: null });
      return;
    }
    pushAction({
      kind: 'select_comment',
      aid: t.aid,
      tagSnippet: `(${t.tag} "${t.textPreview}")`,
      comment: text.trim(),
    });
    this.patch({ pendingComment: null });
    this.clearSelection();
  }

  cancelComment() {
    this.patch({ pendingComment: null });
    this.clearSelection();
  }

  getState(): BridgeState {
    return this.state;
  }

  subscribe(fn: (s: BridgeState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy() {
    this.unsubMessage?.();
    this.unsubMessage = null;
    this.listeners.clear();
  }

  private patch(p: Partial<BridgeState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  /** 广播给所有挂着的 iframe */
  private broadcast(mode: PreviewMode) {
    for (const f of this.iframes) {
      this.postTo(f, { type: 'set_mode', mode });
    }
  }

  private postTo(iframe: HTMLIFrameElement, payload: Record<string, unknown>) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { __aidTarget: 'preview', projectId: this.projectId, ...payload },
      '*'
    );
  }
}

const instances = new Map<number, ElementBridge>();

export function getElementBridge(projectId: number): ElementBridge {
  let b = instances.get(projectId);
  if (!b) {
    b = new ElementBridge(projectId);
    instances.set(projectId, b);
  }
  return b;
}
