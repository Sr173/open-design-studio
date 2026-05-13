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
  dropOrphanServerToolUses,
  compactOldToolResults,
} from './llm/serverTools.js';
import type {
  Block,
  ChatToolDef,
  Delta,
  ProviderMessage,
  ServerConfig,
} from './llm/types.js';
import type { LLMProvider } from './llm/types.js';

export interface StartServerOptions {
  /** 显式端口;0 = OS 分配空闲端口(Electron 用) */
  port?: number;
  /** Bearer token;前端请求必须带 Authorization: Bearer <token>。omitted = 不鉴权(dev 浏览器模式) */
  authToken?: string;
  /** 覆盖 provider 配置;Electron 模式下从 keychain / IPC 传入 */
  providerConfig?: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
    apiKey: string;
    model: string;
    baseUrl?: string;
    authMode?: 'apikey' | 'oauth';
    accountId?: string;
  };
  /** 把 dist/ 静态文件挂到根路径上;Electron packaged 模式用 — renderer loadURL 到本 server */
  serveStaticDir?: string;
}

export interface ServerHandle {
  port: number;
  authToken?: string;
  stop(): void;
}

// === 配置 — 从 env 读默认值,可被 startServer options 覆盖 ===
const defaultConfig: ServerConfig = {
  provider: (process.env.PROVIDER as 'anthropic' | 'openai' | 'gemini' | 'codex') || 'openai',
  model: process.env.MODEL || 'gpt-5.5',
  baseUrl: process.env.BASE_URL || undefined,
  port: Number(process.env.PORT) || 5174,
};

const defaultApiKey = process.env.API_KEY || '';

// 当前活动 config + provider(运行时可被 updateProvider 改)
let config: ServerConfig = { ...defaultConfig };
let provider: LLMProvider | null = defaultApiKey
  ? createProvider({
      provider: config.provider,
      apiKey: defaultApiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    })
  : null;

/** 运行时切换 provider — Electron 改 .env / 改 key 时调 */
export function updateProvider(cfg: {
  provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
  apiKey: string;
  model: string;
  baseUrl?: string;
  authMode?: 'apikey' | 'oauth';
  accountId?: string;
  installationId?: string;
}) {
  config = { ...config, provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl };
  provider = createProvider(cfg);
  console.log(`[server] provider updated → ${cfg.provider} / ${cfg.model}${cfg.authMode === 'oauth' ? ' (oauth)' : ''}`);
}

// === Hono app ===
const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: '*', // dev only;生产应限同源
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// 鉴权 — Electron 模式有 token,浏览器 dev 模式 token 为空就放行。必须在路由前注册。
// /preview/* 不走 token(iframe 不方便带 Authorization 头);只走 localhost + 文件 path 越权防护
let activeAuthToken: string | undefined;
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();
  if (!activeAuthToken) return next();
  const got = c.req.header('Authorization');
  if (got !== `Bearer ${activeAuthToken}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

// === Preview 路由(native 文件夹模式)===
import { previewNativeRouter } from './preview-native.js';
app.route('/preview', previewNativeRouter);

// === 服务 __aid_inject.js (iframe 注入脚本)===
import { readFileSync as _readSync, existsSync as _existsSync } from 'node:fs';
import { dirname as _dirname, join as _join } from 'node:path';
import { fileURLToPath as _fileUrlToPath } from 'node:url';
const __srvDir = _dirname(_fileUrlToPath(import.meta.url));
function findInjectScript(): string {
  // 源码模式:public/__aid_inject.js;打包模式:同目录 __aid_inject.js(build 时复制)
  const candidates = [
    _join(__srvDir, '..', 'public', '__aid_inject.js'),
    _join(__srvDir, '__aid_inject.js'),
  ];
  for (const p of candidates) {
    if (_existsSync(p)) return _readSync(p, 'utf8');
  }
  return '/* __aid_inject.js not found */';
}
let _injectCache: string | null = null;
app.get('/__aid_inject.js', (c) => {
  if (!_injectCache) _injectCache = findInjectScript();
  return new Response(_injectCache, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});

app.get('/api/llm/config', (c) => {
  return c.json({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ?? null,
    hasKey: !!provider,
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

    // 先清理:移除任何孤儿 server-managed tool_use(v1.8 早期 bug 留下的坏数据)
    // 然后 rehydrate:把 placeholder tool_result 还原成真内容
    let history = rehydrateServerToolResults(
      dropOrphanServerToolUses(body.messages)
    );
    // v6.1 + Sprint A.3:压缩老的、超长的 tool_result(read_file / list / search 等)→ stub
    // 减少 input token 浪费,提升 attention 聚焦,降低 Opus 4.7 单轮 cost
    {
      const r = compactOldToolResults(history);
      history = r.messages;
      if (r.compacted > 0) {
        console.log(
          `[compact] elided ${r.compacted} old/large tool_result(s), saved ~${(r.bytesSaved / 1024).toFixed(1)}KB`
        );
      }
    }

    // tools = client 注册 + server-managed
    const allTools: ChatToolDef[] = [
      ...(body.tools ?? []),
      ...SERVER_TOOLS,
    ];

    const system = buildSystemPrompt();
    // Opus 4.7 输出硬上限 128k(实测确认 200k+ 会被 Anthropic 直接拒)
    // 这是 cap 不是预分配,实际只按真生成的 token 计费
    const maxTokens = body.maxTokens ?? 128_000;

    // === Server-managed tool loop ===
    // 一轮 LLM → 若 stop=tool_use 且全 server-managed,server 内部跑工具继续;
    // 否则把 final blocks 给 client(text / 含 client-tool 的 tool_use)
    //
    // 关键:每轮 buffer deltas,等知道这轮是否要给 client 才决定 emit。
    // 中间轮(纯 server-tool)的 deltas 完全丢弃,client 静默(像 AI 直接跳过 read 步骤)

    // 带重试的 provider.chat 调用 — 应对网关瞬时 close stream / 429 / 5xx / 空响应
    async function chatWithRetry(
      callMessages: typeof history,
      onDelta: (d: Delta) => void
    ) {
      const RETRYABLE = [
        'request ended without sending any chunks',
        'rate_limit',
        '429',
        '502',
        '503',
        '504',
        'ECONNRESET',
        'ETIMEDOUT',
      ];
      let lastErr: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await provider!.chat(
            {
              messages: callMessages,
              tools: allTools,
              signal: ac.signal,
              onDelta,
              maxTokens,
            },
            system
          );
          // **空响应也重试** — gpt-5.5 codex / uniapi 这种 fake 模型常排队后丢空 stream
          if (
            result.blocks.length === 0 &&
            result.stopReason === 'unknown' &&
            attempt < 3
          ) {
            console.error(
              `[llm] attempt ${attempt}/3 空响应 (blocks=0 stop=unknown),重试`
            );
            const delay = 1500 * Math.pow(2, attempt - 1) + Math.random() * 500;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return result;
        } catch (e: any) {
          lastErr = e;
          if (e?.name === 'AbortError') throw e;
          const msg = String(e?.message ?? e ?? '');
          const status = e?.status;
          const retryable =
            RETRYABLE.some((k) => msg.includes(k)) ||
            (status >= 500 && status < 600) ||
            status === 429;
          console.error(
            `[llm] attempt ${attempt}/3 failed (retryable=${retryable}): ${msg.slice(0, 200)}`
          );
          if (!retryable || attempt === 3) throw e;
          const delay = 800 * Math.pow(2, attempt - 1) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastErr;
    }

    try {
      let safety = 0;
      while (true) {
        if (safety++ > 8) {
          throw new Error('Server-tool loop exceeded 8 iterations');
        }

        // 收集这一轮 deltas — 决定后 emit 或丢
        const buffered: Delta[] = [];
        const t0 = Date.now();
        const userMsgCount = history.filter((m) => m.role === 'user').length;
        const lastBlock = history[history.length - 1]?.blocks?.slice(-1)?.[0];
        const lastKind =
          lastBlock?.type === 'text'
            ? `text(${(lastBlock.text || '').slice(0, 40).replace(/\n/g, ' ')}...)`
            : lastBlock?.type === 'tool_result'
            ? `tool_result(${
                typeof lastBlock.content === 'string'
                  ? lastBlock.content.slice(0, 40)
                  : '[blocks]'
              })`
            : lastBlock?.type;
        console.log(
          `[chat] iter#${safety} → LLM (msgs=${history.length}, userMsgs=${userMsgCount}, last=${lastKind})`
        );
        const bufferedFinal = await chatWithRetry(history, (d) =>
          buffered.push(d)
        );
        console.log(
          `[chat] iter#${safety} ← LLM ${Date.now() - t0}ms stop=${bufferedFinal.stopReason} blocks=${bufferedFinal.blocks.length}`
        );

        const toolUses = bufferedFinal.blocks.filter(
          (b): b is Extract<Block, { type: 'tool_use' }> =>
            b.type === 'tool_use'
        );
        const onlyServerTools =
          toolUses.length > 0 &&
          toolUses.every((t) => SERVER_TOOL_NAMES.has(t.name));

        // 3 次都空响应 — 直接 throw,让外层 catch 翻译成友好错误
        if (
          bufferedFinal.blocks.length === 0 &&
          bufferedFinal.stopReason === 'unknown'
        ) {
          throw new Error(
            'empty stream after retries — 上游网关瞬时不稳(gpt-5.5 codex 排队 / uniapi fallback 挂)'
          );
        }

        if (bufferedFinal.stopReason !== 'tool_use' || !onlyServerTools) {
          // 最终轮 — emit 给 client。但若是**混合**(LLM 同时调 server + client 工具),
          // 先在 server 端把 server-managed tool 执行掉 + history 推进 + 在 final.blocks 里
          // 把 server-managed tool_use 删除(client 不持久化它,Anthropic API 才不会因 missing
          // tool_result 报错)。client 只看到 client-managed 工具调用。
          const serverUses = toolUses.filter((t) =>
            SERVER_TOOL_NAMES.has(t.name)
          );
          if (serverUses.length > 0) {
            console.log(
              `[chat] mixed-turn: executing ${serverUses.length} server-tool(s) silently`
            );
            // server 内部跑掉(LLM 这一轮已经决定调它们,但 LLM 本轮没真拿到结果)
            for (const t of serverUses) {
              execServerTool(t.name, t.input); // 副作用:确保 server skill cache 走过一遍
            }
            // 从 final blocks 删除 server-managed tool_use
            const filtered = bufferedFinal.blocks.filter(
              (b) =>
                !(b.type === 'tool_use' && SERVER_TOOL_NAMES.has(b.name))
            );
            bufferedFinal.blocks = filtered;
            // 已 buffered 的 deltas 里也含 server-tool 的 tool_call_start / args / end —
            // 一并丢弃这些 delta,client 看到的 stream 只有 client-managed
            // (简化:不重放任何 buffered delta,改为基于 filtered.blocks 重新合成必要的 text delta)
            for (const b of filtered) {
              if (b.type === 'text' && b.text) {
                await stream.writeSSE({
                  event: 'delta',
                  data: JSON.stringify({ type: 'text', text: b.text }),
                });
              } else if (b.type === 'tool_use') {
                await stream.writeSSE({
                  event: 'delta',
                  data: JSON.stringify({
                    type: 'tool_call_start',
                    id: b.id,
                    name: b.name,
                  }),
                });
              }
            }
          } else {
            // 没 server-tool 混入,正常重放 buffered deltas 给 client
            for (const d of buffered) {
              await stream.writeSSE({
                event: 'delta',
                data: JSON.stringify(d),
              });
            }
          }
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
        const raw = err?.message ?? String(err);
        const status = err?.status ?? null;
        // 把常见 LLM 网关瞬时错误翻译成人话
        let friendly = raw;
        if (raw.includes('request ended without sending any chunks')) {
          friendly =
            '上游网关在没返回任何数据前就关闭了 stream(uniapi 瞬时不稳 / 模型 fallback 卡死)。已自动重试 3 次仍失败,稍后或换 model 重试。';
        } else if (raw.includes('empty stream')) {
          friendly =
            '上游连续 3 次返了空响应(等了 90+ 秒后 stream 关掉但 0 字节内容)。' +
            'cr.killvxk.com 后端 gpt-5.5 codex 此刻在排队卡死。' +
            '建议:换模型(.env MODEL=gpt-4o 试试),或者切回 uniapi opus-4-7,或稍等几分钟。';
        } else if (status === 429 || raw.includes('rate_limit')) {
          friendly =
            '上游限速:当前分组在排队中。等几秒重发,或换更轻量的模型(sonnet 4.5 比 opus 4-7 顺一些)。';
        } else if (status === 503 || raw.includes('503')) {
          friendly =
            '上游 503 服务不可用(uniapi 后端这一刻没空闲 channel)。已重试 3 次,稍后再试。';
        } else if (raw.includes('permission') || raw.includes('group')) {
          friendly =
            '上游权限:这把 key 不在该模型的可用 group 里。检查 .env MODEL,或换 key。';
        }
        console.error(`[chat] error (status=${status}): ${raw.slice(0, 300)}`);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: friendly, status, raw }),
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

/** 启动 Hono server。返回 ServerHandle 让调用方拿到实际 port + 可停止。
 *
 *  - CLI 模式(tsx watch server/index.ts):直接调用,默认 port 来自 .env
 *  - Electron 嵌入模式:main process 调 `startServer({ port: 0, authToken, providerConfig })`,
 *    OS 分配空闲端口;authToken 通过 preload 暴露给 renderer */
export async function startServer(
  opts: StartServerOptions = {}
): Promise<ServerHandle> {
  if (opts.providerConfig) {
    updateProvider(opts.providerConfig);
  }
  if (opts.port !== undefined) config.port = opts.port;
  activeAuthToken = opts.authToken;

  // === SPA 静态文件 serving(packaged Electron 用)===
  // 注册在最后,前面的 /api/* 和 /preview/* 路由不受影响
  if (opts.serveStaticDir) {
    const staticRoot = opts.serveStaticDir;
    const { readFile } = await import('node:fs/promises');
    const { extname, join: pj, normalize: pn } = await import('node:path');

    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json',
    };

    // SW 注册 scope = '/' 要求 SW 文件 header 含 Service-Worker-Allowed
    app.get('/sw.js', async (c) => {
      try {
        const buf = await readFile(pj(staticRoot, 'sw.js'));
        return new Response(buf, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Service-Worker-Allowed': '/',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return c.text('sw.js not found', 404);
      }
    });

    // catch-all 静态文件 + SPA fallback
    app.get('*', async (c) => {
      const reqPath = new URL(c.req.url).pathname;
      const safePath = pn(reqPath).replace(/^\/+/, '');
      const ext = extname(safePath).toLowerCase();
      try {
        if (ext) {
          // 有后缀 = 静态资源
          const buf = await readFile(pj(staticRoot, safePath));
          return new Response(buf, {
            headers: {
              'Content-Type': MIME[ext] ?? 'application/octet-stream',
              'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000',
            },
          });
        }
      } catch { /* fall through to index.html */ }
      // SPA fallback
      try {
        const buf = await readFile(pj(staticRoot, 'index.html'));
        return new Response(buf, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      } catch {
        return c.text('not found', 404);
      }
    });
    console.log(`[server] static SPA serving from ${staticRoot}`);
  }

  return new Promise((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: config.port,
      },
      (info) => {
        const actualPort = info.port;
        console.log(
          `[server] ai-design backend → http://127.0.0.1:${actualPort} ` +
            `(provider=${config.provider}, model=${config.model}, auth=${activeAuthToken ? 'on' : 'off'})`
        );
        resolve({
          port: actualPort,
          authToken: activeAuthToken,
          stop: () => server.close(),
        });
      }
    );
  });
}

// === CLI 入口:直接 tsx 跑这个文件时自动启动 ===
// import.meta.url 判定是否 main module(ESM 标准做法)
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const argvUrl = new URL(`file://${argv1}`).href;
    return import.meta.url === argvUrl;
  } catch {
    return false;
  }
})();

if (isMain) {
  startServer().catch((err) => {
    console.error('[server] startup failed', err);
    process.exit(1);
  });
}

export { app };
