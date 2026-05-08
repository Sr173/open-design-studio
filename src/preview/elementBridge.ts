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
  private iframeRef: HTMLIFrameElement | null = null;

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
        // iframe 重载后重新推一次 mode
        if (this.state.mode !== 'preview') {
          this.sendMode(this.state.mode);
        }
      }
    });
  }

  attachIframe(iframe: HTMLIFrameElement | null) {
    this.iframeRef = iframe;
    if (iframe && this.state.mode !== 'preview') {
      this.sendMode(this.state.mode);
    }
  }

  setMode(mode: PreviewMode) {
    this.patch({ mode, selection: null, pendingComment: null });
    this.sendMode(mode);
  }

  clearSelection() {
    if (this.iframeRef?.contentWindow) {
      this.iframeRef.contentWindow.postMessage(
        { __aidTarget: 'preview', projectId: this.projectId, type: 'clear_selection' },
        '*'
      );
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

  private sendMode(mode: PreviewMode) {
    if (!this.iframeRef?.contentWindow) return;
    this.iframeRef.contentWindow.postMessage(
      { __aidTarget: 'preview', projectId: this.projectId, type: 'set_mode', mode },
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
