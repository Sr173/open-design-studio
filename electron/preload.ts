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
    /** 读用户原项目源码(不是 .design/) — 只读 */
    readSource(rootPath: string, relPath: string): Promise<NativeFile | null> {
      return ipcRenderer.invoke('fs:read-source', rootPath, relPath);
    },
    /** 列用户原项目某一层(非递归,像 `ls`);可选 subPath 切换到子目录;
     *  自动:① git 跟踪过滤 ② 黑名单跳过 ③ 单层 200 条 cap */
    listSource(
      rootPath: string,
      subPath: string = ''
    ): Promise<{
      entries: Array<{
        path: string;
        kind: 'file' | 'dir';
        type: FileType;
        size: number;
      }>;
      gitMode: boolean;
      truncated: boolean;
    }> {
      return ipcRenderer.invoke('fs:list-source', rootPath, subPath);
    },
    /** grep + glob 跨命名空间搜索;返 hits[path:line] + 上下 N 行 context */
    search(
      rootPath: string,
      opts: {
        pattern: string;
        glob?: string;
        scope: 'design' | 'source' | 'both';
        caseSensitive?: boolean;
        maxResults?: number;
        contextLines?: number;
      }
    ): Promise<{
      hits: Array<{
        path: string;
        line: number;
        match: string;
        contextBefore: string[];
        contextAfter: string[];
      }>;
      filesScanned: number;
      truncated: boolean;
      patternMode: 'regex' | 'plain';
    }> {
      return ipcRenderer.invoke('fs:search', rootPath, opts);
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
      provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
      account: string;
      model: string;
      baseUrl?: string;
    }): Promise<{ ok: true }> {
      return ipcRenderer.invoke('provider:update', cfg);
    },
  },

  // === OAuth ===
  oauth: {
    login(provider: 'anthropic' | 'openai'): Promise<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      provider: 'anthropic' | 'openai';
    }> {
      return ipcRenderer.invoke('oauth:login', provider);
    },
    logout(provider: 'anthropic' | 'openai'): Promise<void> {
      return ipcRenderer.invoke('oauth:logout', provider);
    },
    status(): Promise<{ anthropic: boolean; openai: boolean }> {
      return ipcRenderer.invoke('oauth:status');
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
