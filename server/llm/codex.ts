/* Codex provider — ChatGPT 订阅登录走 ChatGPT 后端 Responses API
 *
 * 跟普通 OpenAI 完全不同:
 *   endpoint:  https://chatgpt.com/backend-api/codex/responses (不是 /v1/chat/completions)
 *   wire shape: Responses API (input/instructions/output_text),不是 Chat Completions
 *   headers:   完整的 codex_cli_rs 标识 + ChatGPT-Account-ID + originator 等
 *   SSE 事件: response.output_text.delta / response.function_call_arguments.delta / response.completed 等
 *
 * 这是 verified 自 openai/codex Rust 源码 (codex-rs/core/src/client.rs) 的实现
 *
 * Block ↔ Responses 映射:
 *   text                 ↔ {type:'input_text', text}
 *   image                ↔ {type:'input_image', image_url: 'data:image/...'}
 *   tool_use (assistant) ↔ output_item type=function_call {name, call_id, arguments}
 *   tool_result          ↔ {type:'function_call_output', call_id, output}
 *
 * SSE 增量:
 *   text  delta:        response.output_text.delta { delta: '...' }
 *   tool call name 在 response.output_item.added 一次性给(item.name + item.call_id)
 *   tool call args 流:  response.function_call_arguments.delta { delta: '...' }
 *   tool call 结束:    response.output_item.done (item.arguments 含完整 args)
 *   finish:            response.completed (response.status + response.usage)
 */

import { randomUUID } from 'node:crypto';
import { release } from 'node:os';
import type {
  Block,
  ChatRequest,
  ChatResponse,
  ChatToolDef,
  LLMProvider,
  ProviderConfig,
  StopReason,
} from './types.js';

const DEFAULT_BACKEND = 'https://chatgpt.com/backend-api/codex';
const CODEX_VERSION = '0.42.0'; // 这个值跟 OAuth originator 配对,Codex CLI 实际版本

interface CodexResponsesEvent {
  type: string;
  // 各 event 的 payload(用 any 因为 union 太多)
  [k: string]: any;
}

export class CodexProvider implements LLMProvider {
  readonly name = 'codex' as const;
  private accessToken: string;
  private accountId: string;
  private installationId: string;
  private baseUrl: string;
  private model: string;
  private sessionId: string;
  private userAgent: string;

  constructor(cfg: ProviderConfig) {
    if (cfg.authMode !== 'oauth') {
      throw new Error('CodexProvider 只支持 OAuth 模式');
    }
    if (!cfg.accountId) {
      throw new Error('CodexProvider 缺 accountId(从 id_token JWT 的 auth.chatgpt_account_id 解出)');
    }
    this.accessToken = cfg.apiKey;
    this.accountId = cfg.accountId;
    this.installationId = cfg.installationId ?? randomUUID();
    this.baseUrl = cfg.baseUrl ?? DEFAULT_BACKEND;
    this.model = cfg.model;
    // session_id 一个 process 一份(Codex 行为)
    this.sessionId = randomUUID();
    // User-Agent 必须以 codex_cli_rs/version 开头(server 校验)
    this.userAgent = `codex_cli_rs/${CODEX_VERSION} (${process.platform === 'darwin' ? 'macOS' : process.platform} ${release()}; ${process.arch})`;
  }

  async chat(req: ChatRequest, system: string): Promise<ChatResponse> {
    // 1. 把 ProviderMessage[] 转 Responses API input[]
    const input = messagesToResponsesInput(req.messages);

    // 2. tools 转 Responses 格式
    const tools = req.tools.map(toResponsesTool);

    const body = {
      model: this.model,
      instructions: system,
      input,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      parallel_tool_calls: false,
      store: false,
      stream: true,
      // gpt-5-codex 是 reasoning 模型;不发 reasoning effort 默认 medium
      reasoning: this.model.includes('gpt-5') ? { effort: 'medium' } : undefined,
    };

    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`;
    console.log('[codex] →', {
      url,
      model: this.model,
      accountId: this.accountId.slice(0, 8) + '...',
      msgCount: input.length,
      toolCount: tools.length,
    });

    const turnId = randomUUID();
    const requestId = randomUUID();

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'ChatGPT-Account-ID': this.accountId,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          // 关键身份头 — server 全校验,缺一个 403
          'originator': 'codex_cli_rs',
          'User-Agent': this.userAgent,
          'OpenAI-Beta': 'responses=experimental',
          'session_id': this.sessionId,
          'x-codex-installation-id': this.installationId,
          'x-codex-turn-state': 'normal',
          'x-codex-window-id': randomUUID(),
          'x-client-request-id': requestId,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e: any) {
      console.error('[codex] fetch 失败:', e?.message);
      throw e;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      console.error('[codex] HTTP', res.status, text.slice(0, 500));
      throw new Error(
        `Codex API ${res.status}: ${text.slice(0, 200)}` +
          (res.status === 401
            ? '\n(access_token 过期或无效,去设置面板重新登录 ChatGPT)'
            : res.status === 403
              ? '\n(server 拒绝 — 可能 chatgpt_account_id 不对,或 ChatGPT 订阅过期)'
              : '')
      );
    }

    // 3. 解析 SSE 流
    const blocks: Block[] = [];
    let textBuffer = '';
    let stopReason: StopReason = 'unknown';

    // 跟踪当前 in-progress function call(Codex 一次流里可能多个 function call)
    const activeCalls = new Map<string, { id: string; name: string; args: string }>();

    const decoder = new TextDecoder('utf-8');
    let leftover = '';

    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = leftover + decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        leftover = lines.pop() ?? '';
        for (const line of lines) {
          // SSE 每条消息: `data: <json>` 或空行
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev: CodexResponsesEvent;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // commit 剩余 text 到 block
    if (textBuffer) {
      blocks.push({ type: 'text', text: textBuffer });
    }

    return { stopReason, blocks };

    function handleEvent(ev: CodexResponsesEvent) {
      const t = ev.type;
      if (!t) return;

      // ── 纯文本增量 ──
      if (t === 'response.output_text.delta') {
        const delta = ev.delta ?? '';
        if (delta) {
          textBuffer += delta;
          req.onDelta({ type: 'text', text: delta });
        }
        return;
      }

      // ── 工具调用 — Codex 在 output_item.added 一次性给 name 和 call_id ──
      if (t === 'response.output_item.added') {
        const item = ev.item;
        if (item?.type === 'function_call') {
          const callId = item.call_id ?? item.id;
          const name = item.name ?? 'unknown';
          if (!callId) return;
          activeCalls.set(callId, { id: callId, name, args: '' });
          // commit 当前 text(顺序保留)
          if (textBuffer) {
            blocks.push({ type: 'text', text: textBuffer });
            textBuffer = '';
          }
          req.onDelta({ type: 'tool_call_start', id: callId, name });
        }
        return;
      }

      // ── function call args 流式增量 ──
      if (t === 'response.function_call_arguments.delta') {
        const callId = ev.item_id ?? ev.call_id;
        const delta = ev.delta ?? '';
        if (!callId || !delta) return;
        const c = activeCalls.get(callId);
        if (c) {
          c.args += delta;
          req.onDelta({ type: 'tool_call_args', id: callId, chunk: delta });
        }
        return;
      }

      // ── function call 完成 ──
      if (t === 'response.function_call_arguments.done') {
        const callId = ev.item_id ?? ev.call_id;
        if (!callId) return;
        const c = activeCalls.get(callId);
        if (c) {
          // 用 done event 的完整 arguments 替换累积值(避免 delta 漏掉)
          if (typeof ev.arguments === 'string') c.args = ev.arguments;
          req.onDelta({ type: 'tool_call_end', id: callId });
        }
        return;
      }

      // ── output_item 完成 — function_call 在这里 finalize 进 block ──
      if (t === 'response.output_item.done') {
        const item = ev.item;
        if (item?.type === 'function_call') {
          const callId = item.call_id ?? item.id;
          if (!callId) return;
          const c = activeCalls.get(callId);
          const argsRaw = item.arguments ?? c?.args ?? '';
          let input: unknown = {};
          try {
            input = argsRaw ? JSON.parse(argsRaw) : {};
          } catch {
            input = { _raw: argsRaw };
          }
          blocks.push({
            type: 'tool_use',
            id: callId,
            name: item.name ?? c?.name ?? 'unknown',
            input,
          });
          activeCalls.delete(callId);
        }
        return;
      }

      // ── response 完成 ──
      if (t === 'response.completed') {
        const status = ev.response?.status ?? 'completed';
        const finish = ev.response?.incomplete_details?.reason;
        if (status === 'incomplete' && finish === 'max_output_tokens') {
          stopReason = 'max_tokens';
        } else {
          // 有 tool_use blocks → tool_use,否则 end_turn
          stopReason = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
        }
        return;
      }

      // ── 错误事件 ──
      if (t === 'response.failed' || t === 'error') {
        const msg = ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? 'unknown error';
        throw new Error(`Codex stream error: ${msg}`);
      }
    }
  }
}

// ============================================================
// Block ↔ Responses input/output 适配
// ============================================================

function messagesToResponsesInput(messages: Array<{ role: 'user' | 'assistant'; blocks: Block[] }>): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // user message → content array;tool_result 单独成项(Responses 里 user role + content[]
      // 不接 function_call_output,后者是 top-level item)
      const content: any[] = [];
      const toolResults: any[] = [];
      for (const b of m.blocks) {
        if (b.type === 'text') {
          content.push({ type: 'input_text', text: b.text });
        } else if (b.type === 'image') {
          content.push({
            type: 'input_image',
            image_url: `data:${b.source.mediaType};base64,${b.source.data}`,
          });
        } else if (b.type === 'tool_result') {
          const text =
            typeof b.content === 'string'
              ? b.content
              : (b.content as Block[])
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('\n');
          // tool_result → Responses 顶层 function_call_output item
          toolResults.push({
            type: 'function_call_output',
            call_id: b.tool_use_id,
            output: text,
          });
        }
      }
      if (content.length > 0) {
        out.push({ role: 'user', content });
      }
      // function_call_output 顶层 item,放在 user message 后(顺序保留)
      for (const tr of toolResults) out.push(tr);
    } else {
      // assistant message → text + function_call items
      const textParts: any[] = [];
      const calls: any[] = [];
      for (const b of m.blocks) {
        if (b.type === 'text') {
          textParts.push({ type: 'output_text', text: b.text });
        } else if (b.type === 'tool_use') {
          calls.push({
            type: 'function_call',
            call_id: b.id,
            name: b.name,
            arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input),
          });
        }
      }
      if (textParts.length > 0) {
        out.push({ role: 'assistant', content: textParts });
      }
      for (const c of calls) out.push(c);
    }
  }
  return out;
}

function toResponsesTool(t: ChatToolDef): any {
  return {
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    // Codex 不要 strict mode(很多 schema 没法 strict)
    strict: false,
  };
}
