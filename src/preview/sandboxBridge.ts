/* postMessage 协议路由 — 见 plan「多 tab 项目隔离」
 *
 * 来自 iframe 的消息必带 { __aidSource: 'preview', projectId, type, ... }
 * host 端只接收 projectId === currentProjectId 的消息,A tab 的不会跑到 B tab 上
 */

export interface ElementInfo {
  aid: string;
  tag: string;
  ancestry: string;       // "body > main > section#aid-xx > h1#aid-yy"
  textPreview: string;
  editable: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export type PreviewMessage =
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'console';
      level: 'log' | 'info' | 'warn' | 'error' | 'debug';
      args: string[];
      ts: number;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'error';
      message: string;
      filename?: string | null;
      lineno?: number | null;
      colno?: number | null;
      stack?: string | null;
      ts: number;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'ready';
      url: string;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'select';
      info: ElementInfo;
      ts: number;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'comment_target';
      info: ElementInfo;
      ts: number;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'inline_edit';
      aid: string;
      tag: string;
      before: string;
      after: string;
      ts: number;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'element_info_reply';
      requestId: string;
      info: ElementInfo | null;
    }
  | {
      __aidSource: 'preview';
      projectId: number;
      type: 'wheel_zoom';
      deltaY: number;
      /** iframe-local 坐标 — host 转成 wrap-local 再做 anchored zoom */
      ifx: number;
      ify: number;
      ts: number;
    };

export type PreviewListener = (msg: PreviewMessage) => void;

const listeners = new Map<number, Set<PreviewListener>>();

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.__aidSource !== 'preview') return;
    if (typeof data.projectId !== 'number') return;
    const set = listeners.get(data.projectId);
    if (!set) return;
    for (const fn of set) fn(data as PreviewMessage);
  });
}

/** 订阅指定项目的预览消息;返回取消订阅函数 */
export function onPreviewMessage(
  projectId: number,
  fn: PreviewListener
): () => void {
  install();
  let set = listeners.get(projectId);
  if (!set) {
    set = new Set();
    listeners.set(projectId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(projectId);
  };
}

/** 给 iframe 发消息(预留,v1 暂未用到) */
export function sendToPreview(
  iframe: HTMLIFrameElement,
  payload: unknown
): void {
  iframe.contentWindow?.postMessage(payload, '*');
}

// === Console 错误聚合(给 chat.ts 在 done/turn-end 时调) ===
const errorBuffers = new Map<
  number,
  { message: string; ts: number }[]
>();
const ERROR_BUFFER_MAX = 50;

let installedErrorTracking = false;
function installErrorTracking() {
  if (installedErrorTracking) return;
  installedErrorTracking = true;
  install();
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.__aidSource !== 'preview') return;
    if (data.type !== 'error' && !(data.type === 'console' && data.level === 'error'))
      return;
    let buf = errorBuffers.get(data.projectId);
    if (!buf) {
      buf = [];
      errorBuffers.set(data.projectId, buf);
    }
    const message =
      data.type === 'error' ? data.message : (data.args ?? []).join(' ');
    buf.push({ message, ts: data.ts });
    if (buf.length > ERROR_BUFFER_MAX) buf.shift();
  });
}

/** 取最近 N 秒内的 console error(供 done 后展示)*/
export function getRecentErrors(
  projectId: number,
  withinMs: number = 5000
): { message: string; ts: number }[] {
  installErrorTracking();
  const buf = errorBuffers.get(projectId);
  if (!buf) return [];
  const cutoff = Date.now() - withinMs;
  return buf.filter((e) => e.ts >= cutoff);
}

export function clearErrors(projectId: number): void {
  errorBuffers.delete(projectId);
}
