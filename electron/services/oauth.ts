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
  /** Codex 专用:从 id_token JWT 解出来的 chatgpt_account_id,要塞 ChatGPT-Account-ID header */
  accountId?: string;
  provider: 'anthropic' | 'openai';
}

/** 解 JWT payload(不验签,只读 claims)。无效返回 null。 */
function decodeJwtPayload(jwt: string): Record<string, any> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    // base64url → base64,补 padding
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Codex 的 chatgpt_account_id 在 id_token claim "https://api.openai.com/auth" 里 */
function extractChatGPTAccountId(idToken: string): string | null {
  const claims = decodeJwtPayload(idToken);
  if (!claims) return null;
  const auth = claims['https://api.openai.com/auth'];
  if (auth && typeof auth === 'object' && typeof auth.chatgpt_account_id === 'string') {
    return auth.chatgpt_account_id;
  }
  return null;
}

function extractEmail(idToken: string): string | null {
  const claims = decodeJwtPayload(idToken);
  if (!claims) return null;
  return typeof claims.email === 'string' ? claims.email : null;
}

// === Provider 配置 ===
//
// 常量从 Claude Code 1.0.51 cli.js + Codex CLI Rust 源码 verified。改之前对照
// 这些注释,别凭记忆改。
//
// Anthropic — Pro/Max 订阅走 claude.ai/oauth/authorize;Console API-key 流程走
// console.anthropic.com/oauth/authorize。我们要订阅 token,所以用前者。
// token endpoint 都是 console.anthropic.com/v1/oauth/token,body **必须 JSON**。
const ANTHROPIC = {
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scope: 'org:create_api_key user:profile user:inference',
  callbackPort: 54545,
  callbackPath: '/callback',
  bodyFormat: 'json' as const,
};

// OpenAI Codex (ChatGPT 订阅) — 各种参数都比 Anthropic 严
//   - redirect path 必须 /auth/callback(不是 /callback)
//   - scope 必须含 api.connectors.read api.connectors.invoke
//   - 必须带 id_token_add_organizations=true 和 codex_cli_simplified_flow=true
//   - originator=codex_cli_rs(server 看的)
//   - 端口 1455 写死,被占了 fallback 到 1457(Codex 自己也只允许这俩)
//   - token endpoint body **是 form-urlencoded**(不像 anthropic 用 JSON)
const OPENAI = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  callbackPort: 1455,
  fallbackPort: 1457,
  callbackPath: '/auth/callback',
  bodyFormat: 'form' as const,
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

function listenForCallback(
  port: number,
  callbackPath: string,
  expectedState: string,
  timeoutMs = 5 * 60_000,
): Promise<CallbackResult> {
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
        if (u.pathname !== callbackPath) {
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
      console.log(`[oauth] callback server listening on http://127.0.0.1:${port}${callbackPath}`);
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
  clientId: string;
  scope: string;
  callbackPort: number;
  /** 注册的 fallback 端口(允许的备用,例如 Codex 用 1457);undefined = 不允许 fallback */
  fallbackPort?: number;
  callbackPath: string;
  /** 额外加在 authorize URL 上的 query params(provider 各自有 quirks) */
  extraParams?: Record<string, string>;
}): Promise<{ code: string; verifier: string; actualPort: number }> {
  // 端口探测:首选端口 → 备用端口(如允许)→ 否则报错
  let port = opts.callbackPort;
  if (!(await isPortFree(port))) {
    if (opts.fallbackPort && (await isPortFree(opts.fallbackPort))) {
      port = opts.fallbackPort;
      console.warn(`[oauth] 端口 ${opts.callbackPort} 被占用,fallback 到 ${port}`);
    } else {
      // 全占了 → 找占用者 + 详细错误
      const holder = await findPortHolder(opts.callbackPort);
      const fallbackHolder = opts.fallbackPort ? await findPortHolder(opts.fallbackPort) : '';
      const pid = holder.match(/PID (\d+)/)?.[1];
      const lines: string[] = [
        `端口 ${opts.callbackPort}${opts.fallbackPort ? ` 和备用端口 ${opts.fallbackPort}` : ''} 被占用,无法启动 OAuth callback server。`,
        `OAuth 提供方在 client_id 处注册了固定端口,我们不能换其他端口。`,
        '',
        holder ? `占用 :${opts.callbackPort} 的进程:${holder}` : '',
        fallbackHolder ? `占用 :${opts.fallbackPort} 的进程:${fallbackHolder}` : '',
        '',
        pid
          ? `修复方式:终端跑 \`kill ${pid}\`(必要时 \`kill -9 ${pid}\`),然后重试登录。`
          : `修复方式:终端跑 \`lsof -i :${opts.callbackPort}\` 找出进程后 kill。`,
        '',
        `常见原因:已经在跑 Codex / Claude Code CLI;或上一次登录没干净退出。`,
      ].filter(Boolean);
      throw new Error(lines.join('\n'));
    }
  }

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = base64url(randomBytes(16));
  const redirectUri = `http://localhost:${port}${opts.callbackPath}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    scope: opts.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(opts.extraParams ?? {}),
  });
  const url = `${opts.authorizeUrl}?${params.toString()}`;

  console.log('[oauth] opening browser →', url);
  const callbackPromise = listenForCallback(port, opts.callbackPath, state);
  await shell.openExternal(url);

  const { code } = await callbackPromise;
  return { code, verifier, actualPort: port };
}

/** body 编码模式 — Anthropic 要 JSON,Codex 要 form-urlencoded */
type BodyFormat = 'json' | 'form';

function encodeBody(format: BodyFormat, fields: Record<string, string>): {
  body: string;
  contentType: string;
} {
  if (format === 'json') {
    return { body: JSON.stringify(fields), contentType: 'application/json' };
  }
  return {
    body: new URLSearchParams(fields).toString(),
    contentType: 'application/x-www-form-urlencoded',
  };
}

async function exchangeCode(opts: {
  tokenUrl: string;
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  bodyFormat: BodyFormat;
  state?: string; // Anthropic 要求一起 echo back,Codex 不需要
}): Promise<{ access_token: string; refresh_token: string; id_token?: string; expires_in?: number }> {
  const fields: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  };
  if (opts.state) fields.state = opts.state;

  const { body, contentType } = encodeBody(opts.bodyFormat, fields);
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json' },
    body,
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
  bodyFormat: BodyFormat;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const { body, contentType } = encodeBody(opts.bodyFormat, {
    grant_type: 'refresh_token',
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  });
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
}

// === Public API ===

export async function loginAnthropic(): Promise<OAuthTokens> {
  const { code, verifier, actualPort } = await runOAuthFlow({
    authorizeUrl: ANTHROPIC.authorizeUrl,
    clientId: ANTHROPIC.clientId,
    scope: ANTHROPIC.scope,
    callbackPort: ANTHROPIC.callbackPort,
    callbackPath: ANTHROPIC.callbackPath,
    // Claude Code cli 在 URL 上额外带 code=true
    extraParams: { code: 'true' },
  });
  const redirectUri = `http://localhost:${actualPort}${ANTHROPIC.callbackPath}`;
  const tok = await exchangeCode({
    tokenUrl: ANTHROPIC.tokenUrl,
    clientId: ANTHROPIC.clientId,
    code, verifier, redirectUri,
    bodyFormat: ANTHROPIC.bodyFormat,
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
  const { code, verifier, actualPort } = await runOAuthFlow({
    authorizeUrl: OPENAI.authorizeUrl,
    clientId: OPENAI.clientId,
    scope: OPENAI.scope,
    callbackPort: OPENAI.callbackPort,
    fallbackPort: OPENAI.fallbackPort, // 1455 占了用 1457
    callbackPath: OPENAI.callbackPath,
    extraParams: {
      // Codex CLI 必传的 quirky 参数,server 真的会校验
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    },
  });
  const redirectUri = `http://localhost:${actualPort}${OPENAI.callbackPath}`;
  const tok = await exchangeCode({
    tokenUrl: OPENAI.tokenUrl,
    clientId: OPENAI.clientId,
    code, verifier, redirectUri,
    bodyFormat: OPENAI.bodyFormat,
  });
  // 从 id_token JWT 解出 chatgpt_account_id(Codex 后端 ChatGPT-Account-ID header 必传)
  const accountId = tok.id_token ? extractChatGPTAccountId(tok.id_token) : null;
  const email = tok.id_token ? extractEmail(tok.id_token) : null;
  if (!accountId) {
    console.warn('[oauth] 没在 id_token 里找到 chatgpt_account_id — Codex 后端可能拒绝');
  } else {
    console.log(`[oauth] codex account_id = ${accountId.slice(0, 8)}... email = ${email ?? '?'}`);
  }
  const tokens: OAuthTokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    idToken: tok.id_token,
    expiresAt: Date.now() + ((tok.expires_in ?? 3600) * 1000),
    provider: 'openai',
    accountId: accountId ?? undefined,
    accountEmail: email ?? undefined,
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

/** 拿到 OAuth 关联的 accountId(Codex 用),不会 refresh */
export async function getAccountId(provider: 'anthropic' | 'openai'): Promise<string | null> {
  const t = await getStoredTokens(provider);
  return t?.accountId ?? null;
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
      bodyFormat: cfg.bodyFormat,
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
