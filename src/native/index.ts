/* Native bridge — renderer 与 Electron preload 之间的接口
 *
 * 浏览器版下:window.aiDesignNative === undefined,所有 native.* 调用都会返回 null/throw,
 * 业务层用 isElectron() 判断。
 *
 * 启动时调用 initNative() 一次性拿到 hono baseUrl + token 缓存,
 * 后续 apiFetch() 自动拼接 + 注入 Authorization 头。
 */

export type FileType = 'text' | 'binary';

export interface NativeFile {
  path: string;
  type: FileType;
  size: number;
  mtime: number;
  content: string;
}

export interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  deleted: number;
}

export interface GitFileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | '??' | 'R' | '!';
}

export interface FsChangeEvent {
  rootPath: string;
  relPath: string;
  kind: 'add' | 'change' | 'unlink';
  ts: number;
}

export interface NativeAPI {
  getHonoConfig(): Promise<{ baseUrl: string; authToken: string } | null>;
  getAppVersion(): Promise<string>;
  getPlatform(): Promise<NodeJS.Platform>;
  fs: {
    read(rootPath: string, relPath: string): Promise<NativeFile | null>;
    write(rootPath: string, relPath: string, content: string, type?: FileType): Promise<void>;
    list(rootPath: string): Promise<Array<{ path: string; type: FileType; size: number; mtime: number }>>;
    delete(rootPath: string, relPaths: string[]): Promise<void>;
    validateRoot(rootPath: string): Promise<boolean>;
  };
  dialog: {
    pickDirectory(): Promise<string | null>;
  };
  git: {
    isRepo(rootPath: string): Promise<boolean>;
    info(rootPath: string): Promise<GitInfo | null>;
    fileStatuses(rootPath: string): Promise<GitFileStatus[]>;
  };
  keychain: {
    get(account: string): Promise<string | null>;
    set(account: string, value: string): Promise<void>;
    delete(account: string): Promise<boolean>;
    list(): Promise<Array<{ account: string; hasValue: boolean }>>;
  };
  provider: {
    update(cfg: {
      provider: 'anthropic' | 'openai';
      account: string;
      model: string;
      baseUrl?: string;
    }): Promise<{ ok: true }>;
  };
  watcher: {
    start(rootPath: string): Promise<true>;
    stop(rootPath: string): Promise<void>;
    onChange(handler: (ev: FsChangeEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    aiDesignNative?: NativeAPI;
  }
}

interface HonoConn {
  baseUrl: string;
  authToken?: string;
}

let conn: HonoConn = { baseUrl: '' };

export async function initNative(): Promise<void> {
  if (!window.aiDesignNative) {
    console.log('[native] browser mode — using relative /api/* paths');
    return;
  }
  try {
    const cfg = await window.aiDesignNative.getHonoConfig();
    if (cfg) {
      conn = { baseUrl: cfg.baseUrl, authToken: cfg.authToken };
      console.log(`[native] electron mode — Hono at ${cfg.baseUrl}`);
      // 让 previewUrl 拿到 Hono baseUrl(给 native 项目 iframe 用)
      const { setHonoBaseUrl } = await import('../preview/injectBuilder');
      setHonoBaseUrl(cfg.baseUrl);
    }
  } catch (e) {
    console.error('[native] getHonoConfig failed', e);
  }
}

export function isElectron(): boolean {
  return !!window.aiDesignNative;
}

/** Electron 模式下返回 native API,浏览器返回 null */
export function native(): NativeAPI | null {
  return window.aiDesignNative ?? null;
}

export function apiFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
  const url = conn.baseUrl
    ? `${conn.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`
    : apiPath;
  const headers = new Headers(init.headers);
  if (conn.authToken) {
    headers.set('Authorization', `Bearer ${conn.authToken}`);
  }
  return fetch(url, { ...init, headers });
}
