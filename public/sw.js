/* Service Worker — 预览文件解析层
 *
 * 见 plan「文件系统」+「多 tab 项目隔离」节:
 *   - 拦截 /preview/<projectId>/<path> 请求
 *   - 从 IndexedDB 查 (projectId + path) → 返回文件内容
 *   - 文件是 HTML 时:在 <head> 顶部注入 window.__previewProjectId,在 </body> 前注入 inject.js
 *
 * 不用 Dexie,直接 indexedDB.open,SW 里更轻量
 */

const DB_NAME = 'ai-design-data-v2';
// SW 不指定 version — 只读模式永远不触发 upgrade,
// 否则老 SW 残留时会把 DB 版本无限往上抬,主线程 Dexie 怎么 bump 都追不上
// SW 版本标记 — 改这个数字强制 SW 更新
const SW_VERSION = 7;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

const PREVIEW_PREFIX = '/preview/';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREVIEW_PREFIX)) return;

  const rest = url.pathname.slice(PREVIEW_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return;

  const projectId = Number(rest.slice(0, slash));
  let filePath = rest.slice(slash + 1);
  // 默认入口
  if (filePath === '' || filePath.endsWith('/')) {
    filePath = (filePath || '') + 'index.html';
  }

  if (Number.isNaN(projectId)) return;

  event.respondWith(serveFile(projectId, filePath));
});

async function serveFile(projectId, path) {
  try {
    const file = await readFileFromIDB(projectId, path);
    if (!file) {
      return new Response(
        `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:monospace;color:#888;background:#fff">
<h2 style="color:#444;font-weight:600">empty project</h2>
<p>path <code>${path}</code> not yet written. ask AI to start.</p></body></html>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    const contentType = inferContentType(path);
    let body = file.content;
    let bodyBytes = null;

    if (contentType.startsWith('text/html')) {
      body = injectIntoHtml(body, projectId);
    } else if (file.type === 'binary') {
      // base64 → Uint8Array
      bodyBytes = base64ToBytes(body);
    }

    return new Response(bodyBytes ?? body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(
      `<pre style="font-family:monospace;padding:24px;color:#c33">SW error\n${String(e)}</pre>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

function inferContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map = {
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

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function injectIntoHtml(html, projectId) {
  const headInject = `<script>window.__previewProjectId=${projectId};</script>`;
  const tailInject = `<script src="/__aid_inject.js"></script>`;

  // 注入 head — 在 <head> 后(尽早,以便 inject.js 能读到)
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + headInject);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(
      /<html[^>]*>/i,
      (m) => m + `<head>${headInject}</head>`
    );
  } else {
    html = headInject + html;
  }

  // 注入 body 尾
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, tailInject + '</body>');
  } else {
    html = html + tailInject;
  }
  return html;
}

// === IDB read (no Dexie) ===

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      // 不指定 version:只取当前 schema,不触发 upgrade
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB blocked'));
    });
  }
  return dbPromise;
}

async function readFileFromIDB(projectId, path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let db;
    try {
      db = await openDB();
    } catch (e) {
      dbPromise = null;
      if (attempt > 0) throw e;
      continue;
    }
    if (!db.objectStoreNames.contains('files')) {
      // schema 不全(主线程 Dexie 还没建)→ 销毁缓存等一下重开
      try {
        db.close();
      } catch (_) {}
      dbPromise = null;
      if (attempt > 0) return null; // 主线程仍未就位,返回 null 触发 404
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    return await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');
        const idx = store.index('[projectId+path]');
        const req = idx.get([projectId, path]);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  return null;
}

// 监听 versionchange:Dexie 升级 schema 时,旧 connection 必须关掉让升级通过
self.addEventListener('versionchange', () => {});  // SW 上下文里这事件不触发,但留个引用

// 主动监听 — db 实例的 versionchange
async function ensureDbVersionWatcher() {
  try {
    const db = await openDB();
    db.onversionchange = () => {
      try {
        db.close();
      } catch (_) {}
      dbPromise = null;
    };
  } catch (_) {}
}
ensureDbVersionWatcher();
