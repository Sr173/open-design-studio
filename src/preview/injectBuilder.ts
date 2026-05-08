/* iframe 加载 URL 构造 + cache-bust
 *
 * SW 拦截 /preview/<projectId>/<path>;给一个 stale-bust query 让 iframe 重载
 */

export function previewUrl(
  projectId: number,
  path: string = 'index.html',
  bust: number | string = ''
): string {
  const q = bust ? `?t=${encodeURIComponent(bust)}` : '';
  return `/preview/${projectId}/${path}${q}`;
}
