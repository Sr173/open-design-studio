/* Hono 子路由 — 服务本地文件夹的预览
 *
 * URL 格式:/preview/r/<base64url-encoded-rootPath>/<relPath>
 *
 * 安全:
 *   - rootPath 是 base64url 解码后的绝对路径,readFile 内部 resolveSafe 防越权
 *   - 同 SW 行为一致:HTML 末尾注入 __aid_inject.js + 头部注入 __previewProjectId
 *     (虽然 native 模式里 projectId 已不在 URL,改为用 rootPath 作为 stable 标识)
 *
 * 限制:
 *   - 不带鉴权(localhost only,token 在 URL 里会破坏 iframe 相对路径)
 *   - 调用方负责正确编码 rootPath
 */

import { Hono } from 'hono';
import { readFile, validateRoot, DESIGN_DIR } from '../electron/services/fs.js';

const router = new Hono();

router.get('/r/:rootB64/*', async (c) => {
  const rootB64 = c.req.param('rootB64');
  let relPath = c.req.path.split(`/r/${rootB64}/`)[1] ?? '';
  relPath = relPath.replace(/^\/+/, '');
  if (!relPath) relPath = 'index.html';

  let rootPath: string;
  try {
    rootPath = Buffer.from(rootB64, 'base64url').toString('utf8');
    validateRoot(rootPath);
  } catch (e: any) {
    return c.text(`bad rootPath: ${e.message}`, 400);
  }

  let file;
  try {
    file = await readFile(rootPath, relPath);
  } catch (e: any) {
    return c.text(`error: ${e.message}`, 400);
  }
  if (!file) {
    return c.html(
      `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:monospace;color:#888;background:#fff">
<h2 style="color:#444;font-weight:600">空项目</h2>
<p style="color:#666">AI 还没向 <code>${rootPath}/${DESIGN_DIR}/${relPath}</code> 写过任何文件。</p>
<p style="color:#888;margin-top:16px">在左边 chat 里跟 AI 说一下,比如"做个 SaaS 落地页",AI 会把生成的文件放进
 <code>.design/</code> 子目录里。</p></body></html>`,
      404
    );
  }

  const contentType = inferContentType(relPath);
  let body: string | Buffer = file.content;

  if (contentType.startsWith('text/html')) {
    // 如果 client 传了 pid 数字,就用它(给 sandboxBridge 匹配);否则 fallback rootB64 字符串
    const pidParam = c.req.query('pid');
    const pidNum = pidParam && /^\d+$/.test(pidParam) ? Number(pidParam) : null;
    const injectedId: number | string = pidNum ?? rootB64;
    body = injectIntoHtml(file.content, injectedId);
  } else if (file.type === 'binary') {
    body = Buffer.from(file.content, 'base64');
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
});

function inferContentType(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  };
  return map[ext] ?? 'text/plain; charset=utf-8';
}

/** 跟 SW 注入逻辑一致 */
function injectIntoHtml(html: string, projectKey: string | number): string {
  // projectKey 是数字(优先,匹配 sandboxBridge 的 number 检查)或 rootB64 string(fallback)
  const headInject = `<script>window.__previewProjectId=${JSON.stringify(projectKey)};</script>`;
  const tailInject = `<script src="/__aid_inject.js"></script>`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + headInject);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + `<head>${headInject}</head>`);
  } else {
    html = headInject + html;
  }
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, tailInject + '</body>');
  } else {
    html = html + tailInject;
  }
  return html;
}

export { router as previewNativeRouter };
