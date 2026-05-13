/* Electron 主进程入口
 *
 * 职责:
 *   1. 启动嵌入的 Hono server(import 现有 server/index.ts)
 *   2. 创建 BrowserWindow,加载 renderer
 *      - dev:  http://localhost:5173(vite dev server)
 *      - prod: file://<app>/dist/index.html
 *   3. 通过 preload 把 hono baseUrl + authToken 暴露给 renderer
 *
 * 后续 sprint 还会在这里加:fs IPC / dialog / chokidar watcher / keytar
 */

import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
// 嵌入式启动 Hono:server/index.ts 已被 refactor 成可 import
import { startServer, type ServerHandle } from '../server/index.js';
import { registerIpc, stopAllWatchers } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_DEV = !app.isPackaged;

// === 完全禁用 Electron / Chromium 的 OS Keychain 集成 ===
//
// Chromium 默认会用 OS 密钥库给 cookies / saved passwords / network 凭据加密:
//   macOS:  Keychain  (会弹"想要使用钥匙串"密码框)
//   Linux:  GNOME Keyring / KWallet
//   Windows: DPAPI
//
// 我们是个独立 App,没保存用户密码,cookies 也不敏感(都是 dev token)。
// 不需要 OS 级密钥库 — 用 basic 模式让 Chromium 把加密数据存 plain 文件,
// 永远不弹任何系统钥匙串授权框。
//
// 必须在 app ready 之前 appendSwitch
app.commandLine.appendSwitch('password-store', 'basic');
// 关 Chromium 的 in-process safe storage 提示(部分版本会冒"chrome 想存密码"对话框)
app.commandLine.appendSwitch('use-mock-keychain'); // macOS 上特别有效

// === 数据存储位置 → ~/.design ===
//
// Electron 默认 userData = ~/Library/Application Support/<productName>/(macOS),
// 跟 Apple 推荐做法对齐但用户看不见 / 不方便清理。
//
// 我们改成 ~/.design,符合 dev 工具习惯(~/.claude / ~/.aws / ~/.docker)。
// 改 userData 后,所有 Electron 自带数据(IndexedDB / Cookies / Cache / Local Storage)
// 跟我们自己的(secrets.json / installation-id.txt)统一搬到新位置。
//
// 一次性迁移:启动时,如果旧默认位置有数据 + 新位置没数据,自动 copy 过去
// (老用户升级到新版无缝过渡,旧目录保留不删,可手动清)
{
  const oldUserData = app.getPath('userData'); // setPath 之前 = 默认值
  const newUserData = path.join(homedir(), '.design-studio');
  if (existsSync(oldUserData) && !existsSync(newUserData)) {
    try {
      mkdirSync(newUserData, { recursive: true });
      cpSync(oldUserData, newUserData, { recursive: true });
      console.log(`[migrate] userData 已迁移: ${oldUserData} → ${newUserData}`);
    } catch (e) {
      console.warn('[migrate] userData 迁移失败,新位置从空开始:', (e as Error).message);
    }
  } else if (!existsSync(newUserData)) {
    mkdirSync(newUserData, { recursive: true });
  }
  app.setPath('userData', newUserData);
  console.log(`[electron] userData → ${newUserData}`);
}

// === 注册 app:// custom protocol ===
//
// 为什么用 custom protocol(而不是 loadURL http://127.0.0.1:<port>):
//   - Hono 用 OS 分配空闲端口,每次重启端口可能变
//   - 端口变 → origin 变 → IndexedDB 按 origin 隔离 → profile/projects/chat 全丢
//   - 用 `app://workbench` 固定 origin,即便 Hono 端口变,IDB origin 也稳
//
// privileges 必须在 app.whenReady 之前设,否则 SW / fetch / corsEnabled 都不通
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,           // 让 origin、history、cookies 按标准方式工作
      secure: true,             // SW 注册要求 secure context
      supportFetchAPI: true,    // fetch() 支持
      allowServiceWorkers: true, // 必须,否则 PreviewPane SW 注册失败
      stream: true,             // 流式 response.body
      corsEnabled: true,
      bypassCSP: false,
    },
  },
]);

let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;

async function bootHono(): Promise<ServerHandle> {
  // dev:固定 5174 方便排查(也接受 0 自动分配,但 dev 时固定更好调试)
  // prod:用 0 让 OS 给空闲端口(端口可变,renderer 走 app:// 协议,origin 不受影响)
  const port = IS_DEV ? 5174 : 0;
  const authToken = randomBytes(24).toString('hex');
  // packaged 模式:Hono 仍然 serve dist/(给 /preview/* 等用),但 renderer 自己用
  // app:// 协议加载,不直连 Hono URL
  const serveStaticDir = IS_DEV ? undefined : path.join(__dirname, '..', 'dist');
  return startServer({ port, authToken, serveStaticDir });
}

/** 注册 app:// 协议 handler — 从 dist/ 读静态文件,SPA fallback 到 index.html */
function registerAppProtocol(distDir: string) {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    // url.host = 'workbench',pathname = '/index.html' etc.
    let pathname = decodeURIComponent(url.pathname || '/');
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    // 防越权:strip 前导斜杠后用 path.join 拼,再确认结果还在 distDir 下
    const safeRel = pathname.replace(/^\/+/, '');
    const candidate = path.normalize(path.join(distDir, safeRel));
    if (!candidate.startsWith(distDir)) {
      return new Response('forbidden', { status: 403 });
    }
    // 静态资源(有 ext)→ 直接 serve,否则 SPA fallback 给 index.html
    const hasExt = path.extname(safeRel) !== '';
    if (hasExt && existsSync(candidate)) {
      return net.fetch(pathToFileURL(candidate).toString());
    }
    const fallback = path.join(distDir, 'index.html');
    if (existsSync(fallback)) {
      return net.fetch(pathToFileURL(fallback).toString());
    }
    return new Response('not found', { status: 404 });
  });
}

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 要用 node:crypto 等 — sandbox=true 会禁这些
    },
  });

  if (IS_DEV) {
    await win.loadURL('http://localhost:5173');
    // DevTools 不自动开;⌘⌥I 手动呼出
  } else {
    // packaged 模式:走 app:// 自定义协议加载,确保 origin 稳定(IndexedDB 不丢)
    // 资源 fetch + SW 都在 app://workbench 这个 origin 下
    await win.loadURL('app://workbench/');
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
}

app.whenReady().then(async () => {
  // 注册所有 IPC handler(在 createWindow 之前 — preload 一启动就要能 invoke)
  registerIpc(() => mainWindow);

  // 注册 app:// protocol handler(packaged 才用,dev 走 vite)
  if (!IS_DEV) {
    const distDir = path.join(__dirname, '..', 'dist');
    registerAppProtocol(distDir);
    console.log(`[electron] app:// protocol → ${distDir}`);
  }

  // 起 Hono
  serverHandle = await bootHono();
  console.log(
    `[electron] embedded Hono → http://127.0.0.1:${serverHandle.port}`
  );

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await stopAllWatchers();
  serverHandle?.stop();
  serverHandle = null;
});

// === IPC:暴露 hono 配置给 renderer(只读)===

ipcMain.handle('app:hono-config', () => {
  if (!serverHandle) return null;
  return {
    baseUrl: `http://127.0.0.1:${serverHandle.port}`,
    authToken: serverHandle.authToken,
  };
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:platform', () => process.platform);
