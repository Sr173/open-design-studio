/* Native bridge — renderer 与 Electron preload 之间的接口
 *
 * 在浏览器版下,window.aiDesignNative 不存在,所有方法降级到 fetch 同源 /api/*
 *
 * 启动时调用 initNative() 一次性拿到 hono baseUrl + token 缓存起来,
 * 后续 apiFetch() 自动拼接 + 注入 Authorization 头。
 */

export interface NativeAPI {
  getHonoConfig(): Promise<{ baseUrl: string; authToken: string } | null>;
  getAppVersion(): Promise<string>;
  getPlatform(): Promise<NodeJS.Platform>;
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

let conn: HonoConn = { baseUrl: '' }; // 默认空 = 同源相对路径

/** App 启动时调一次。
 *  Electron:从 preload 拿 baseUrl + token
 *  浏览器:no-op,保持相对路径 */
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
    }
  } catch (e) {
    console.error('[native] getHonoConfig failed', e);
  }
}

export function isElectron(): boolean {
  return !!window.aiDesignNative;
}

/** API fetch 包装 — 自动用正确的 baseUrl + token */
export function apiFetch(
  apiPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = conn.baseUrl
    ? `${conn.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`
    : apiPath;
  const headers = new Headers(init.headers);
  if (conn.authToken) {
    headers.set('Authorization', `Bearer ${conn.authToken}`);
  }
  return fetch(url, { ...init, headers });
}
