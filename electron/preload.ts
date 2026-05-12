/* preload — 在 renderer 加载前注入,通过 contextBridge 暴露 native API
 *
 * 安全约束:
 *   - 永远不直接暴露 ipcRenderer.invoke;每个能力包装成具名函数
 *   - renderer 通过 window.aiDesignNative.<namespace>.<method> 调用
 *   - 后续 sprint 在这里加 fs / dialog / git / keychain 等命名空间
 */

import { contextBridge, ipcRenderer } from 'electron';

const native = {
  /** Hono 嵌入式 server 的连接信息 — renderer 用这个发请求代替 /api/llm/chat */
  async getHonoConfig(): Promise<{ baseUrl: string; authToken: string } | null> {
    return ipcRenderer.invoke('app:hono-config');
  },
  async getAppVersion(): Promise<string> {
    return ipcRenderer.invoke('app:version');
  },
  async getPlatform(): Promise<NodeJS.Platform> {
    return ipcRenderer.invoke('app:platform');
  },
};

contextBridge.exposeInMainWorld('aiDesignNative', native);

// 给 TS 用的类型(在 renderer 端通过 declare global 引用)
export type NativeAPI = typeof native;
