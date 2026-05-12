/* IPC 注册 — 把 services 暴露给 renderer
 *
 * 安全约束:
 *   - 每个 handler 自己 validate 输入
 *   - renderer 拿不到任意 fs / shell;只能通过这里定义好的能力
 *   - keychain 读取后字符串仍要返回给 renderer(否则 LLM 调用无法走 renderer→main IPC 转上游)
 *     —— 现状 LLM 调用走嵌入式 Hono(在 main),所以 key 不需要给 renderer,只需要让 Hono 内部能拿到。
 *     这是未来 sprint 的事:把 server provider 切换接到 keychain
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fsService from './services/fs.js';
import * as gitService from './services/git.js';
import * as keychainService from './services/keychain.js';
import {
  startWatcher,
  stopWatcher,
  stopAllWatchers,
  markAIWrite,
} from './services/watcher.js';
import { updateProvider } from '../server/index.js';

export function registerIpc(getMainWindow: () => BrowserWindow | null) {
  // === fs ===
  ipcMain.handle('fs:read', async (_e, rootPath: string, relPath: string) => {
    return fsService.readFile(rootPath, relPath);
  });
  ipcMain.handle(
    'fs:write',
    async (
      _e,
      rootPath: string,
      relPath: string,
      content: string,
      type: 'text' | 'binary'
    ) => {
      // 写之前先标记 watcher 抑制,避免回声触发"外部改动"通知
      markAIWrite(rootPath, relPath);
      await fsService.writeFile(rootPath, relPath, content, type);
      // 写之后再标一次,覆盖 chokidar 延迟事件
      markAIWrite(rootPath, relPath);
    }
  );
  ipcMain.handle('fs:list', async (_e, rootPath: string) => {
    return fsService.listFiles(rootPath);
  });
  ipcMain.handle('fs:delete', async (_e, rootPath: string, relPaths: string[]) => {
    for (const p of relPaths) markAIWrite(rootPath, p);
    return fsService.deleteFile(rootPath, relPaths);
  });
  ipcMain.handle('fs:validate-root', (_e, rootPath: string) => {
    fsService.validateRoot(rootPath); // throws if invalid
    return true;
  });

  // === dialog ===
  ipcMain.handle('dialog:pick-directory', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // === git ===
  ipcMain.handle('git:is-repo', (_e, rootPath: string) =>
    gitService.isRepo(rootPath)
  );
  ipcMain.handle('git:info', (_e, rootPath: string) =>
    gitService.getInfo(rootPath)
  );
  ipcMain.handle('git:file-statuses', (_e, rootPath: string) =>
    gitService.getFileStatuses(rootPath)
  );

  // === keychain ===
  ipcMain.handle('keychain:get', (_e, account: string) =>
    keychainService.getKey(account)
  );
  ipcMain.handle('keychain:set', (_e, account: string, value: string) =>
    keychainService.setKey(account, value)
  );
  ipcMain.handle('keychain:delete', (_e, account: string) =>
    keychainService.deleteKey(account)
  );
  ipcMain.handle('keychain:list', () => keychainService.listAccounts());

  // === provider 切换(renderer 设置面板改 key/model 时)===
  ipcMain.handle(
    'provider:update',
    async (
      _e,
      cfg: {
        provider: 'anthropic' | 'openai';
        account: string; // keychain account 名
        model: string;
        baseUrl?: string;
      }
    ) => {
      const apiKey = await keychainService.getKey(cfg.account);
      if (!apiKey) throw new Error(`keychain 里没找到 account=${cfg.account}`);
      updateProvider({
        provider: cfg.provider,
        apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
      });
      return { ok: true };
    }
  );

  // === watcher ===
  ipcMain.handle('watcher:start', (_e, rootPath: string) => {
    const win = getMainWindow();
    if (!win) throw new Error('main window not ready');
    startWatcher(rootPath, win.webContents);
    return true;
  });
  ipcMain.handle('watcher:stop', (_e, rootPath: string) => stopWatcher(rootPath));
}

export { stopAllWatchers };
