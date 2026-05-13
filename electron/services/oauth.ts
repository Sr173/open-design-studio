/* OAuth — Anthropic Console + OpenAI Codex (ChatGPT login)
 *
 * 走 PKCE flow:
 *   1. 客户端生成 code_verifier (43-128 char URL-safe random)
 *   2. code_challenge = SHA256(verifier),base64url
 *   3. 起本地 HTTP server,redirect_uri = http://localhost:<port>/callback
 *   4. shell.openExternal 打开浏览器,用户登录后 redirect 回 localhost
 *   5. 拿到 code → 用 verifier 换 access_token + refresh_token
 *   6. tokens 存 keychain(整个 OAuth payload JSON)
 *
 * 两个 provider 的 endpoint / client_id / scope 都不一样,见下面常量
 *
 * 注:目前仅 anthropic console 已被多个开源项目验证可用(Claude Code / opencode / cc-switch)
 * OpenAI Codex 的 ChatGPT login 是 codex-cli 官方机制,scope / endpoint 已公开
 */

import { shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';
import { setKey, getKey, deleteKey } from './keychain.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number; // ms epoch
  accountEmail?: string;
  provider: 'anthropic' | 'openai';
}

// === Provider 配置 ===
//
// Anthropic Console — client_id 是 Claude Code CLI 的公开 ID,被 opencode / cc-switch 复用
// 注意:Anthropic 不正式支持第三方客户端用 OAuth,这是借用 Claude Code 凭据的 grey area
// 用户必须有 Claude Pro / Team / Enterprise 订阅
const ANTHROPIC = {
  authorizeUrl: 'https://console.anthropic.com/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scope: 'org:create_api_key user:profile user:inference',
};

// OpenAI Codex — ChatGPT 订阅登录,被 codex-cli / opencode 使用
// client_id 是 codex 公开 ID
const OPENAI = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scope: 'openid profile email offline_access',
};

const KEYCHAIN_ANTHROPIC = 'oauth:anthropic';
const KEYCHAIN_OPENAI = 'oauth:openai-codex';

// === PKCE 辅助 ===
function generateVerifier(): string {
  return base64url(randomBytes(32));
}
function generateChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// === 本地 callback server ===
interface CallbackResult {
  code: string;
  state: string;
}

/** 探测端口是否可用 — 用一个临时 server listen 一下立即关掉 */
async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

/** 找占用某端口的进程命令(macOS / Linux) */
async function findPortHolder(port: number): Promise<string> {
  try {
    const { exec } = await import('node:child_process');
    return await new Promise<string>((resolve) => {
      exec(`lsof -i :${port} -P -n -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1`, (err, stdout) => {
        if (err || !stdout) return resolve('');
        // 取 COMMAND PID
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) resolve(`${parts[0]} (PID ${parts[1]})`);
        else resolve('');
      });
    });
  } catch {
    return '';
  }
}

function listenForCallback(port: number, expectedState: string, timeoutMs = 5 * 60_000): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    let timer: NodeJS.Timeout | null = null;

    const close = () => {
      if (timer) clearTimeout(timer);
      if (server) server.close();
    };

    timer = setTimeout(() => {
      close();
      reject(new Error('OAuth callback 超时(5 分钟)'));
    }, timeoutMs);

    server = createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', `http://localhost:${port}`);
        if (u.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const code = u.searchParams.get('code');
        const state = u.searchParams.get('state');
        const error = u.searchParams.get('error');

        if (error) {
          res.statusCode = 400;
          res.end(`<html><body><h2>登录失败</h2><p>${escapeHtml(error)}</p><p>请回到 Open Design Studio 重试。</p></body></html>`);
          close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.end('missing code/state');
          return;
        }

        if (state !== expectedState) {
          res.statusCode = 400;
          res.end('state mismatch');
          close();
          reject(new Error('OAuth state mismatch — 可能是 CSRF'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<html><body style="font-family:system-ui;padding:40px;text-align:center;">
          <h2 style="color:#2a8;">✓ 登录成功</h2>
          <p style="color:#666;">可以关闭这个标签页,回到 Open Design Studio 继续。</p>
          <script>setTimeout(()=>window.close(),1500);</script>
        </body></html>`);
        close();
        resolve({ code, state });
      } catch (e: any) {
        res.statusCode = 500;
        res.end(`internal error: ${e?.message ?? e}`);
        close();
        reject(e);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`[oauth] callback server listening on http://127.0.0.1:${port}/callback`);
    });
    server.on('error', (err) => {
      close();
      reject(err);
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// === 主流程 ===
async function runOAuthFlow(opts: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  callbackPort: number;
  /** true = 这个端口在 OpenAI 注册时写死了,占用时报错让用户处理;
   *  false = 可以 fallback 到附近空闲端口 */
  portStrict: boolean;
}): Promise<{ code: string; verifier: string; actualPort: number }> {
  // 先探测端口
  let port = opts.callbackPort;
  if (!(await isPortFree(port))) {
    if (opts.portStrict) {
      const holder = await findPortHolder(port);
      const hint = holder
        ? `占用进程:${holder}。终端跑 \`kill ${holder.match(/PID (\d+)/)?.[1] ?? ''}\` 释放后再试。`
        : `终端跑 \`lsof -i :${port}\` 查占用进程,kill 掉再重试。`;
      throw new Error(
        `端口 ${port} 已被占用。OpenAI Codex OAuth 要求严格使用此端口(在 client_id 处注册),不能换。\n${hint}\n常见原因:你已经登录过 Codex CLI 并且它的后台进程还在,或者上一次登录没干净退出。`
      );
    }
    // 非 strict:找下一个空闲端口
    for (let p = port + 1; p < port + 20; p++) {
      if (await isPortFree(p)) {
        port = p;
        console.warn(`[oauth] 端口 ${opts.callbackPort} 被占用,fallback 到 ${p}`);
        break;
      }
    }
    if (port === opts.callbackPort) {
      throw new Error(`端口 ${port}~${port + 19} 全被占用,无法启动 callback server`);
    }
  }

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = base64url(randomBytes(16));
  const redirectUri = `http://localhost:${port}/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    scope: opts.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const url = `${opts.authorizeUrl}?${params.toString()}`;

  console.log('[oauth] opening browser →', url);
  const callbackPromise = listenForCallback(port, state);
  await shell.openExternal(url);

  const { code } = await callbackPromise;
  return { code, verifier, actualPort: port };
}

async function exchangeCode(opts: {
  tokenUrl: string;
  clientId: string;
  code: string;
  verifier: string;
  callbackPort: number;
}): Promise<{ access_token: string; refresh_token: string; id_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: `http://localhost:${opts.callbackPort}/callback`,
    code_verifier: opts.verifier,
  });
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; id_token?: string; expires_in?: number }>;
}

async function refreshAccessToken(opts: {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  });
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
}

// === Public API ===

export async function loginAnthropic(): Promise<OAuthTokens> {
  // Anthropic Console 的 redirect_uri 不严格,占用了就换一个端口
  const { code, verifier, actualPort } = await runOAuthFlow({
    authorizeUrl: ANTHROPIC.authorizeUrl,
    tokenUrl: ANTHROPIC.tokenUrl,
    clientId: ANTHROPIC.clientId,
    scope: ANTHROPIC.scope,
    callbackPort: 54321,
    portStrict: false,
  });
  const tok = await exchangeCode({
    tokenUrl: ANTHROPIC.tokenUrl,
    clientId: ANTHROPIC.clientId,
    code, verifier, callbackPort: actualPort,
  });
  const tokens: OAuthTokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + ((tok.expires_in ?? 3600) * 1000),
    provider: 'anthropic',
  };
  await setKey(KEYCHAIN_ANTHROPIC, JSON.stringify(tokens));
  console.log('[oauth] anthropic login success');
  return tokens;
}

export async function loginOpenAI(): Promise<OAuthTokens> {
  // Codex CLI 在 OpenAI 注册的 redirect_uri 严格写死 1455,不能 fallback
  const { code, verifier, actualPort } = await runOAuthFlow({
    authorizeUrl: OPENAI.authorizeUrl,
    tokenUrl: OPENAI.tokenUrl,
    clientId: OPENAI.clientId,
    scope: OPENAI.scope,
    callbackPort: 1455,
    portStrict: true,
  });
  const tok = await exchangeCode({
    tokenUrl: OPENAI.tokenUrl,
    clientId: OPENAI.clientId,
    code, verifier, callbackPort: actualPort,
  });
  const tokens: OAuthTokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    idToken: tok.id_token,
    expiresAt: Date.now() + ((tok.expires_in ?? 3600) * 1000),
    provider: 'openai',
  };
  await setKey(KEYCHAIN_OPENAI, JSON.stringify(tokens));
  console.log('[oauth] openai (codex) login success');
  return tokens;
}

export async function getStoredTokens(provider: 'anthropic' | 'openai'): Promise<OAuthTokens | null> {
  const account = provider === 'anthropic' ? KEYCHAIN_ANTHROPIC : KEYCHAIN_OPENAI;
  const raw = await getKey(account);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

/** 拿到一个仍有效的 access token,自动 refresh */
export async function getAccessToken(provider: 'anthropic' | 'openai'): Promise<string | null> {
  const t = await getStoredTokens(provider);
  if (!t) return null;
  // 提前 60 秒 refresh,避免请求过程中 expire
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  const cfg = provider === 'anthropic' ? ANTHROPIC : OPENAI;
  try {
    const refreshed = await refreshAccessToken({
      tokenUrl: cfg.tokenUrl,
      clientId: cfg.clientId,
      refreshToken: t.refreshToken,
    });
    const account = provider === 'anthropic' ? KEYCHAIN_ANTHROPIC : KEYCHAIN_OPENAI;
    const next: OAuthTokens = {
      ...t,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + ((refreshed.expires_in ?? 3600) * 1000),
    };
    await setKey(account, JSON.stringify(next));
    return next.accessToken;
  } catch (e) {
    console.error(`[oauth] refresh ${provider} failed`, e);
    return null;
  }
}

export async function logout(provider: 'anthropic' | 'openai'): Promise<void> {
  const account = provider === 'anthropic' ? KEYCHAIN_ANTHROPIC : KEYCHAIN_OPENAI;
  await deleteKey(account);
  console.log(`[oauth] ${provider} logged out`);
}

export async function status(): Promise<{ anthropic: boolean; openai: boolean }> {
  const [a, o] = await Promise.all([getStoredTokens('anthropic'), getStoredTokens('openai')]);
  return { anthropic: !!a, openai: !!o };
}
