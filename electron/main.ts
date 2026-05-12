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

import { app, BrowserWindow, ipcMain } from 'electron';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 嵌入式启动 Hono:server/index.ts 已被 refactor 成可 import
import { startServer, type ServerHandle } from '../server/index.js';
import { registerIpc, stopAllWatchers } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_DEV = !app.isPackaged;

let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;

async function bootHono(): Promise<ServerHandle> {
  // dev:固定 5174 方便排查(也接受 0 自动分配,但 dev 时固定更好调试)
  // prod:用 0 让 OS 给空闲端口
  const port = IS_DEV ? 5174 : 0;
  const authToken = randomBytes(24).toString('hex');
  return startServer({ port, authToken });
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
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    await win.loadFile(indexPath);
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
}

app.whenReady().then(async () => {
  // 注册所有 IPC handler(在 createWindow 之前 — preload 一启动就要能 invoke)
  registerIpc(() => mainWindow);

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
