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
import * as keychainService from './services/secureStore.js';
import * as oauthService from './services/oauth.js';
import * as modelsListService from './services/modelsList.js';
import { getInstallationId } from './services/installationId.js';
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

  // source 命名空间 — 只读用户原代码(不进 .design/)
  ipcMain.handle('fs:read-source', (_e, rootPath: string, relPath: string) =>
    fsService.readSource(rootPath, relPath)
  );
  ipcMain.handle(
    'fs:list-source',
    (_e, rootPath: string, subPath: string = '') =>
      fsService.listSource(rootPath, subPath)
  );
  ipcMain.handle(
    'fs:search',
    (_e, rootPath: string, opts: fsService.SearchOpts) =>
      fsService.searchFiles(rootPath, opts)
  );

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
        provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
        account: string; // keychain account 名(或 'oauth:anthropic' / 'oauth:openai-codex')
        model: string;
        baseUrl?: string;
      }
    ) => {
      // OAuth 路径:account 是 'oauth:xxx' → 拉 access_token 而非 raw key
      if (cfg.account.startsWith('oauth:')) {
        const oauthProvider = cfg.account === 'oauth:anthropic' ? 'anthropic' :
                              cfg.account === 'oauth:openai-codex' ? 'openai' : null;
        if (!oauthProvider) throw new Error(`unknown oauth account: ${cfg.account}`);
        const token = await oauthService.getAccessToken(oauthProvider);
        if (!token) throw new Error(`OAuth ${oauthProvider} 未登录或 refresh 失败 — 去设置面板登录`);
        // Codex 还要 chatgpt_account_id 才能调 backend-api
        const accountId =
          cfg.provider === 'codex' ? await oauthService.getAccountId(oauthProvider) : undefined;
        if (cfg.provider === 'codex' && !accountId) {
          throw new Error(
            'Codex 登录缺 chatgpt_account_id(id_token JWT 里没找到 auth.chatgpt_account_id claim)。请退出 ChatGPT 重新订阅登录。'
          );
        }
        updateProvider({
          provider: cfg.provider,
          apiKey: token,
          model: cfg.model,
          baseUrl: cfg.baseUrl,
          authMode: 'oauth',
          accountId: accountId ?? undefined,
          installationId: cfg.provider === 'codex' ? getInstallationId() : undefined,
        });
        return { ok: true };
      }

      // 普通 API key 路径
      const apiKey = await keychainService.getKey(cfg.account);
      if (!apiKey) throw new Error(`keychain 里没找到 account=${cfg.account}`);
      updateProvider({
        provider: cfg.provider,
        apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        authMode: 'apikey',
      });
      return { ok: true };
    }
  );

  // === Models list ===
  ipcMain.handle(
    'models:list',
    (_e, opts: modelsListService.ListModelsOpts) => modelsListService.listModels(opts)
  );

  // === OAuth ===
  ipcMain.handle('oauth:login', async (_e, provider: 'anthropic' | 'openai') => {
    if (provider === 'anthropic') return oauthService.loginAnthropic();
    if (provider === 'openai') return oauthService.loginOpenAI();
    throw new Error(`unknown oauth provider: ${provider}`);
  });
  ipcMain.handle('oauth:logout', (_e, provider: 'anthropic' | 'openai') =>
    oauthService.logout(provider)
  );
  ipcMain.handle('oauth:status', () => oauthService.status());

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
