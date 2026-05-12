/* preload — 在 renderer 加载前注入,通过 contextBridge 暴露 native API
 *
 * 安全约束:
 *   - 永远不直接暴露 ipcRenderer.invoke;每个能力包装成具名函数
 *   - renderer 通过 window.aiDesignNative.<namespace>.<method> 调用
 */

import { contextBridge, ipcRenderer } from 'electron';

type FileType = 'text' | 'binary';
interface NativeFile {
  path: string;
  type: FileType;
  size: number;
  mtime: number;
  content: string;
}
interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  deleted: number;
}
interface GitFileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | '??' | 'R' | '!';
}
interface FsChangeEvent {
  rootPath: string;
  relPath: string;
  kind: 'add' | 'change' | 'unlink';
  ts: number;
}

const native = {
  // === Hono ===
  async getHonoConfig(): Promise<{ baseUrl: string; authToken: string } | null> {
    return ipcRenderer.invoke('app:hono-config');
  },
  async getAppVersion(): Promise<string> {
    return ipcRenderer.invoke('app:version');
  },
  async getPlatform(): Promise<NodeJS.Platform> {
    return ipcRenderer.invoke('app:platform');
  },

  // === fs ===
  fs: {
    read(rootPath: string, relPath: string): Promise<NativeFile | null> {
      return ipcRenderer.invoke('fs:read', rootPath, relPath);
    },
    write(
      rootPath: string,
      relPath: string,
      content: string,
      type: FileType = 'text'
    ): Promise<void> {
      return ipcRenderer.invoke('fs:write', rootPath, relPath, content, type);
    },
    list(
      rootPath: string
    ): Promise<Array<{ path: string; type: FileType; size: number; mtime: number }>> {
      return ipcRenderer.invoke('fs:list', rootPath);
    },
    delete(rootPath: string, relPaths: string[]): Promise<void> {
      return ipcRenderer.invoke('fs:delete', rootPath, relPaths);
    },
    validateRoot(rootPath: string): Promise<boolean> {
      return ipcRenderer.invoke('fs:validate-root', rootPath);
    },
  },

  // === dialog ===
  dialog: {
    pickDirectory(): Promise<string | null> {
      return ipcRenderer.invoke('dialog:pick-directory');
    },
  },

  // === git(只读)===
  git: {
    isRepo(rootPath: string): Promise<boolean> {
      return ipcRenderer.invoke('git:is-repo', rootPath);
    },
    info(rootPath: string): Promise<GitInfo | null> {
      return ipcRenderer.invoke('git:info', rootPath);
    },
    fileStatuses(rootPath: string): Promise<GitFileStatus[]> {
      return ipcRenderer.invoke('git:file-statuses', rootPath);
    },
  },

  // === keychain ===
  keychain: {
    get(account: string): Promise<string | null> {
      return ipcRenderer.invoke('keychain:get', account);
    },
    set(account: string, value: string): Promise<void> {
      return ipcRenderer.invoke('keychain:set', account, value);
    },
    delete(account: string): Promise<boolean> {
      return ipcRenderer.invoke('keychain:delete', account);
    },
    list(): Promise<Array<{ account: string; hasValue: boolean }>> {
      return ipcRenderer.invoke('keychain:list');
    },
  },

  // === provider 切换 ===
  provider: {
    update(cfg: {
      provider: 'anthropic' | 'openai';
      account: string;
      model: string;
      baseUrl?: string;
    }): Promise<{ ok: true }> {
      return ipcRenderer.invoke('provider:update', cfg);
    },
  },

  // === watcher ===
  watcher: {
    start(rootPath: string): Promise<true> {
      return ipcRenderer.invoke('watcher:start', rootPath);
    },
    stop(rootPath: string): Promise<void> {
      return ipcRenderer.invoke('watcher:stop', rootPath);
    },
    onChange(handler: (ev: FsChangeEvent) => void): () => void {
      const listener = (_e: unknown, ev: FsChangeEvent) => handler(ev);
      ipcRenderer.on('fs:change', listener);
      return () => ipcRenderer.removeListener('fs:change', listener);
    },
  },
};

contextBridge.exposeInMainWorld('aiDesignNative', native);

export type NativeAPI = typeof native;
