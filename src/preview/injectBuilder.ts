/* iframe 加载 URL 构造 + cache-bust
 *
 * 两种模式:
 *   - 浏览器虚拟项目(rootPath = null):SW 拦截 /preview/<projectId>/<path>
 *   - Electron 本地文件夹:走嵌入式 Hono /preview/r/<base64-root>/<path>
 *
 * previewUrl 同步函数,需要先拿到 rootPath;调用方在 PreviewPane 里
 * useEffect 异步取 rootPath,缓存到状态里再构造 URL
 */

let honoBaseUrl: string | null = null;
export function setHonoBaseUrl(url: string | null) {
  honoBaseUrl = url;
}

export function previewUrl(
  projectId: number,
  path: string = 'index.html',
  bust: number | string = '',
  rootPath?: string | null
): string {
  if (rootPath && honoBaseUrl) {
    // Electron 模式:走 Hono native 路由,rootPath base64 编码进 URL
    // **pid 也一并传**,让 Hono 注入 __previewProjectId 为 numeric IDB id,
    // 否则 host 端 sandboxBridge 的 `typeof projectId === 'number'` 判定会丢弃消息
    const rootB64 = base64UrlEncode(rootPath);
    const params = new URLSearchParams();
    if (bust) params.set('t', String(bust));
    params.set('pid', String(projectId));
    return `${honoBaseUrl}/preview/r/${rootB64}/${path}?${params.toString()}`;
  }

  // SW 模式
  const q = bust ? `?t=${encodeURIComponent(bust)}` : '';
  return `/preview/${projectId}/${path}${q}`;
}

function base64UrlEncode(s: string): string {
  // browser-safe base64url
  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
