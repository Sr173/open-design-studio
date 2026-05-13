/* Dynamic model list fetcher
 *
 * 给每个 provider 调对应的 /models endpoint,normalize 成 string[]
 *
 * Anthropic / Anthropic OAuth:  GET <baseUrl ?? api.anthropic.com>/v1/models
 *   - API key: x-api-key + anthropic-version
 *   - OAuth:   Authorization: Bearer + anthropic-version + anthropic-beta: oauth-2025-04-20
 *   - 响应: { data: [{id, display_name, type, created_at}, ...] }
 *
 * OpenAI / OpenAI-compat (DeepSeek/Moonshot/OpenRouter/Groq/Together/Mistral/uniapi/Ollama):
 *   GET <baseUrl ?? api.openai.com/v1>/models
 *   Headers: Authorization: Bearer <key>
 *   响应: { data: [{id, ...}, ...] } 或 [...] 直接数组(部分网关)
 *
 * Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>
 *   响应: { models: [{name: "models/gemini-2.0-flash", ...}, ...] }
 *
 * Codex (ChatGPT backend): 没有标准 list endpoint,返回 unsupported
 *
 * 失败时:Cloudflare/网络等错误时也返回 null,UI fallback 到 preset 推荐
 */

import * as keychainService from './keychain.js';
import * as oauthService from './oauth.js';

export interface ListModelsResult {
  /** 'api' = 从 provider /models 拉到;'unsupported' = provider 没接口 */
  source: 'api' | 'unsupported';
  models: string[];
  /** API 返回时一些 model 带 display name,这里附带提供 */
  displayNames?: Record<string, string>;
  /** 拉取时戳(ms) */
  fetchedAt: number;
}

export interface ListModelsOpts {
  provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
  /** keychain account 或 'oauth:anthropic' / 'oauth:openai-codex' */
  account: string;
  baseUrl?: string;
}

export async function listModels(opts: ListModelsOpts): Promise<ListModelsResult> {
  // Codex 没有标准接口
  if (opts.provider === 'codex') {
    return { source: 'unsupported', models: [], fetchedAt: Date.now() };
  }

  // 拿 key/token
  let auth: { key: string; isOAuth: boolean };
  if (opts.account.startsWith('oauth:')) {
    const oauthProvider = opts.account === 'oauth:anthropic' ? 'anthropic' :
                          opts.account === 'oauth:openai-codex' ? 'openai' : null;
    if (!oauthProvider) throw new Error(`unknown oauth account: ${opts.account}`);
    const token = await oauthService.getAccessToken(oauthProvider);
    if (!token) throw new Error(`OAuth ${oauthProvider} 未登录`);
    auth = { key: token, isOAuth: true };
  } else {
    const apiKey = await keychainService.getKey(opts.account);
    if (!apiKey) throw new Error(`keychain 里没找到 account=${opts.account}`);
    auth = { key: apiKey, isOAuth: false };
  }

  if (opts.provider === 'anthropic') {
    return listAnthropic(opts.baseUrl, auth);
  }
  if (opts.provider === 'gemini') {
    return listGemini(auth);
  }
  // openai 及一切 openai-compat gateway
  return listOpenAICompat(opts.baseUrl, auth);
}

// ============================================================
// Anthropic
// ============================================================
async function listAnthropic(
  baseUrl: string | undefined,
  auth: { key: string; isOAuth: boolean }
): Promise<ListModelsResult> {
  const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const url = `${base}/v1/models?limit=100`;
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    Accept: 'application/json',
  };
  if (auth.isOAuth) {
    headers['Authorization'] = `Bearer ${auth.key}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    headers['x-api-key'] = auth.key;
  }
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic /v1/models ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const data = Array.isArray(json) ? json : (json.data ?? []);
  const models: string[] = [];
  const displayNames: Record<string, string> = {};
  for (const m of data) {
    if (typeof m === 'string') {
      models.push(m);
    } else if (m?.id) {
      models.push(m.id);
      if (m.display_name) displayNames[m.id] = m.display_name;
    }
  }
  return { source: 'api', models, displayNames, fetchedAt: Date.now() };
}

// ============================================================
// OpenAI / OpenAI-compat gateways
// ============================================================
async function listOpenAICompat(
  baseUrl: string | undefined,
  auth: { key: string; isOAuth: boolean }
): Promise<ListModelsResult> {
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.key}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI-compat /models ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  // 标准: {data: [...]} ;部分 gateway 直接数组;OpenRouter 用 {data: [{id, name, ...}]}
  const data = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
  const models: string[] = [];
  const displayNames: Record<string, string> = {};
  for (const m of data) {
    if (typeof m === 'string') {
      models.push(m);
    } else if (m?.id) {
      models.push(m.id);
      if (m.name && m.name !== m.id) displayNames[m.id] = m.name;
    }
  }
  return { source: 'api', models, displayNames, fetchedAt: Date.now() };
}

// ============================================================
// Gemini
// ============================================================
async function listGemini(
  auth: { key: string; isOAuth: boolean }
): Promise<ListModelsResult> {
  // Gemini 的 list endpoint 用 query string 传 key,不走 Bearer
  if (auth.isOAuth) {
    throw new Error('Gemini OAuth 模式暂不支持 list models');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(auth.key)}&pageSize=100`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini /models ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const models: string[] = [];
  const displayNames: Record<string, string> = {};
  for (const m of json.models ?? []) {
    if (!m?.name) continue;
    // name 形如 "models/gemini-2.0-flash" — strip prefix
    const id = m.name.replace(/^models\//, '');
    // 只要支持 generateContent 的 model(filter 掉 embed / aqa 等)
    const supportsChat = Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.includes('generateContent')
      : true; // 不知道就放过
    if (!supportsChat) continue;
    models.push(id);
    if (m.displayName) displayNames[id] = m.displayName;
  }
  return { source: 'api', models, displayNames, fetchedAt: Date.now() };
}
