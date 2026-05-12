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
import { readSkillSection, listSkillSections } from './skill-chapters.js';
import {
  SERVER_TOOLS,
  SERVER_TOOL_NAMES,
  execServerTool,
  rehydrateServerToolResults,
} from './llm/serverTools.js';
import type {
  Block,
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
    c.req.raw.signal?.addEventListener('abort', () => ac.abort());

    // 客户端发来的 messages 含 server-tool 的 placeholder tool_result,先重建真内容给 LLM
    let history = rehydrateServerToolResults(body.messages);

    // tools = client 注册 + server-managed
    const allTools: ChatToolDef[] = [
      ...(body.tools ?? []),
      ...SERVER_TOOLS,
    ];

    const system = buildSystemPrompt();
    const maxTokens = body.maxTokens ?? 16384;

    // === Server-managed tool loop ===
    // 一轮 LLM → 若 stop=tool_use 且全 server-managed,server 内部跑工具继续;
    // 否则把 final blocks 给 client(text / 含 client-tool 的 tool_use)
    //
    // 关键:每轮 buffer deltas,等知道这轮是否要给 client 才决定 emit。
    // 中间轮(纯 server-tool)的 deltas 完全丢弃,client 静默(像 AI 直接跳过 read 步骤)

    try {
      let safety = 0;
      while (true) {
        if (safety++ > 8) {
          // 防 server-tool 自循环
          throw new Error('Server-tool loop exceeded 8 iterations');
        }

        // 收集这一轮 deltas — 决定后 emit 或丢
        const buffered: Delta[] = [];
        const bufferedFinal = await provider!.chat(
          {
            messages: history,
            tools: allTools,
            signal: ac.signal,
            onDelta: (d) => buffered.push(d),
            maxTokens,
          },
          system
        );

        const toolUses = bufferedFinal.blocks.filter(
          (b): b is Extract<Block, { type: 'tool_use' }> =>
            b.type === 'tool_use'
        );
        const onlyServerTools =
          toolUses.length > 0 &&
          toolUses.every((t) => SERVER_TOOL_NAMES.has(t.name));

        if (bufferedFinal.stopReason !== 'tool_use' || !onlyServerTools) {
          // 这一轮是最终轮:可能是 text-only end_turn,或者含 client-managed tool。
          // **把 buffered deltas 重放给 client**(尽量保留流式体感;失去的只是首字延迟)
          for (const d of buffered) {
            await stream.writeSSE({
              event: 'delta',
              data: JSON.stringify(d),
            });
          }
          // final blocks 的 tool_use(name in SERVER_TOOL_NAMES)留着,但
          // 真到这里说明这一轮没有 server-tool(onlyServerTools=false → 要么没 tool_use,
          // 要么含 client-tool 但也许混着 server-tool)。
          // 如果混合:把 server-tool 的 tool_use 留给 client 看到,client 不执行(它工具集没有);
          //   下一轮 client 把 messages 回传时,server rehydrate 兜底
          console.log(
            `[chat] stopReason=${bufferedFinal.stopReason} blocks=${bufferedFinal.blocks.length} (final)`
          );
          await stream.writeSSE({
            event: 'final',
            data: JSON.stringify(bufferedFinal),
          });
          break;
        }

        // 全是 server-managed tool_use → server 自己跑,deltas 丢弃
        console.log(
          `[chat] server-loop: ${toolUses.map((t) => t.name).join(',')}`
        );

        // append assistant message(完整真 blocks)到 history
        history.push({ role: 'assistant', blocks: bufferedFinal.blocks });

        // 跑每个 server tool,得到 tool_result blocks
        const toolResults: Block[] = [];
        for (const t of toolUses) {
          const r = execServerTool(t.name, t.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: r.realContent,
            is_error: r.isError,
          });
        }
        history.push({ role: 'user', blocks: toolResults });
        // 继续 while 进入下一轮 LLM
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        await stream.writeSSE({ event: 'aborted', data: '{}' });
      } else {
        const msg = err?.message ?? String(err);
        const status = err?.status ?? null;
        console.error(`[chat] error: ${msg}`);
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

// v1.8:按需拉 skill 章节(前端 read_skill 工具调它)
app.get('/api/skill/sections', (c) =>
  c.json({ sections: listSkillSections() })
);
app.get('/api/skill', (c) => {
  const section = c.req.query('section');
  if (!section) return c.json({ error: 'section query required' }, 400);
  const body = readSkillSection(section);
  if (!body) {
    return c.json(
      {
        error: `unknown section: ${section}`,
        available: listSkillSections(),
      },
      404
    );
  }
  return c.json({ section, content: body });
});

app.get('/api/health', (c) => c.text('ok'));

console.log(
  `[server] ai-design backend → http://localhost:${config.port} (provider=${config.provider}, model=${config.model})`
);

serve({
  fetch: app.fetch,
  port: config.port,
});
