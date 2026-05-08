/* ai-design 后端 — Hono + SSE
 *
 * 职责:
 *   - 持有 API key + system prompt(SKILL.md + coda)
 *   - /api/llm/chat:接前端 messages + tools schema,注入 system + 调上游,SSE 流式回 Delta
 *   - /api/llm/config:告诉前端当前 provider/model(只读展示用)
 *
 * 前端永远拿不到 key 和 system prompt
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { createProvider } from './llm/factory.js';
import { buildSystemPrompt } from './llm/systemPrompt.js';
import type {
  ChatToolDef,
  Delta,
  ProviderMessage,
  ServerConfig,
} from './llm/types.js';

// === 配置 ===
const config: ServerConfig = {
  provider: (process.env.PROVIDER as 'anthropic' | 'openai') || 'openai',
  model: process.env.MODEL || 'gpt-5.5',
  baseUrl: process.env.BASE_URL || undefined,
  port: Number(process.env.PORT) || 5174,
};

const apiKey = process.env.API_KEY || '';
if (!apiKey) {
  console.warn(
    '[server] ⚠ API_KEY 未设置 — /api/llm/chat 会失败。在 .env 里补上'
  );
}

// === 复用一个 provider 实例 ===
let provider = apiKey
  ? createProvider({
      provider: config.provider,
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    })
  : null;

// === Hono app ===
const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: '*', // dev only;生产应限同源
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
);

app.get('/api/llm/config', (c) => {
  return c.json({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ?? null,
    hasKey: !!apiKey,
  });
});

interface ChatBody {
  messages: ProviderMessage[];
  tools: ChatToolDef[];
  maxTokens?: number;
}

app.post('/api/llm/chat', async (c) => {
  if (!provider) {
    return c.json({ error: 'API_KEY not configured on server' }, 503);
  }
  let body: ChatBody;
  try {
    body = (await c.req.json()) as ChatBody;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ error: 'messages required' }, 400);
  }

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    // 客户端断开时,abort 上游
    c.req.raw.signal?.addEventListener('abort', () => ac.abort());

    const onDelta = async (d: Delta) => {
      try {
        await stream.writeSSE({
          event: 'delta',
          data: JSON.stringify(d),
        });
      } catch (_) {}
    };

    try {
      const system = buildSystemPrompt();
      const result = await provider!.chat(
        {
          messages: body.messages,
          tools: body.tools ?? [],
          signal: ac.signal,
          onDelta,
          // max output tokens — 多变体 HTML 容易超 8192,默认拉到 16384
          maxTokens: body.maxTokens ?? 16384,
        },
        system
      );
      console.log(
        `[chat] stopReason=${result.stopReason} blocks=${result.blocks.length}`
      );
      await stream.writeSSE({
        event: 'final',
        data: JSON.stringify(result),
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        await stream.writeSSE({ event: 'aborted', data: '{}' });
      } else {
        const msg = err?.message ?? String(err);
        const status = err?.status ?? null;
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: msg, status }),
        });
      }
    } finally {
      try {
        await stream.writeSSE({ event: 'done', data: '{}' });
      } catch (_) {}
      await stream.close();
    }
  });
});

app.get('/api/health', (c) => c.text('ok'));

console.log(
  `[server] ai-design backend → http://localhost:${config.port} (provider=${config.provider}, model=${config.model})`
);

serve({
  fetch: app.fetch,
  port: config.port,
});
