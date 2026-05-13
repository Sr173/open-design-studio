/* OpenAI 规范 provider — Node 端 */

import OpenAI from 'openai';
import type {
  Block,
  ChatRequest,
  ChatResponse,
  ChatToolDef,
  LLMProvider,
  ProviderConfig,
  ProviderMessage,
  StopReason,
} from './types.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  private client: OpenAI;
  private model: string;

  constructor(cfg: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
    });
    this.model = cfg.model;
  }

  async chat(req: ChatRequest, system: string): Promise<ChatResponse> {
    const oaiMessages: any[] = [{ role: 'system', content: system }];
    for (const m of req.messages) {
      oaiMessages.push(...providerMessageToOpenAI(m));
    }

    const tools = req.tools.map(toOpenAITool);

    // max_tokens 只在客户端显式传时才发 — 否则让 provider model 默认决定
    // 这样避免给"上限 64k"的兼容网关(如 dashscope)发 128k 触发 400
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: oaiMessages,
        tools: tools.length ? tools : undefined,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        stream: true,
      },
      { signal: req.signal }
    );

    let textAccum = '';
    const toolCallMap = new Map<
      number,
      { id: string; name: string; argsBuffer: string }
    >();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta as any;

      if (typeof delta.content === 'string' && delta.content) {
        textAccum += delta.content;
        req.onDelta({ type: 'text', text: delta.content });
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let entry = toolCallMap.get(idx);
          if (!entry) {
            entry = { id: '', name: '', argsBuffer: '' };
            toolCallMap.set(idx, entry);
          }
          const wasFresh = !entry.id;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string') {
            entry.argsBuffer += tc.function.arguments;
            req.onDelta({
              type: 'tool_call_args',
              id: entry.id,
              chunk: tc.function.arguments,
            });
          }
          if (wasFresh && entry.id && entry.name) {
            req.onDelta({
              type: 'tool_call_start',
              id: entry.id,
              name: entry.name,
            });
          }
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const blocks: Block[] = [];
    if (textAccum) blocks.push({ type: 'text', text: textAccum });
    for (const entry of toolCallMap.values()) {
      let parsed: unknown = {};
      let split: unknown[] | null = null;
      try {
        parsed = entry.argsBuffer ? JSON.parse(entry.argsBuffer) : {};
      } catch {
        // 网关 / 模型 bug 兜底:有些上游(如某 Gemini 套 OpenAI 协议的网关)把
        // 多个 tool_call 拼成一个 args 串,变成 `{"path":"a"}{"path":"b"}`。
        // 试着按顶层 brace 平衡拆开,如果每段都是合法 JSON 就当多个独立 tool_use。
        split = trySplitConcatenatedJSON(entry.argsBuffer);
        if (!split) {
          parsed = { __parseError: true, raw: entry.argsBuffer };
        }
      }
      if (split && split.length > 0) {
        console.warn(
          `[openai] tool_call ${entry.name} 收到 ${split.length} 个拼接 JSON,自动拆成多个 tool_use`,
        );
        for (let i = 0; i < split.length; i++) {
          blocks.push({
            type: 'tool_use',
            id: i === 0 ? entry.id : `${entry.id}-${i}`,
            name: entry.name,
            input: split[i],
          });
        }
      } else {
        blocks.push({
          type: 'tool_use',
          id: entry.id,
          name: entry.name,
          input: parsed,
        });
      }
    }

    // 兜底:有些网关(尤其是套了 anthropic/gemini 模型的 OpenAI-compat 网关)
    // 在 message 里 emit 了 tool_calls 但 finish_reason 报 'stop' 而不是 'tool_calls'。
    // 客户端按 mapFinishReason 看成 end_turn → 不跑工具循环 → orphan tool_use。
    // 修复:blocks 里只要有 tool_use,强制 stopReason = 'tool_use'(信现实不信上游 label)。
    const hasToolUse = blocks.some((b) => b.type === 'tool_use');
    return {
      stopReason: hasToolUse ? 'tool_use' : mapFinishReason(finishReason),
      blocks,
    };
  }
}

function providerMessageToOpenAI(m: ProviderMessage): any[] {
  if (m.role === 'user') {
    const parts: any[] = [];
    const toolResults: any[] = [];
    for (const b of m.blocks) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image')
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${b.source.mediaType};base64,${b.source.data}`,
          },
        });
      else if (b.type === 'tool_result') {
        toolResults.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content:
            typeof b.content === 'string'
              ? b.content
              : (b.content as any[])
                  .map((c: any) => (c.type === 'text' ? c.text : ''))
                  .join('\n'),
        });
      }
    }
    const out: any[] = [];
    if (toolResults.length) out.push(...toolResults);
    if (parts.length) {
      out.push({
        role: 'user',
        content:
          parts.length === 1 && parts[0].type === 'text'
            ? parts[0].text
            : parts,
      });
    }
    return out;
  } else {
    let text = '';
    const toolCalls: any[] = [];
    for (const b of m.blocks) {
      if (b.type === 'text') text += b.text;
      else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        });
      }
    }
    const msg: any = { role: 'assistant' };
    if (text) msg.content = text;
    if (toolCalls.length) msg.tool_calls = toolCalls;
    if (!text && !toolCalls.length) msg.content = '';
    return [msg];
  }
}

function toOpenAITool(t: ChatToolDef): any {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  };
}

function mapFinishReason(r: string | null): StopReason {
  switch (r) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'unknown';
  }
}

/** 尝试把 `{"a":1}{"b":2}` 这种拼接 JSON 用顶层 brace 平衡切开。
 *  每段都得是合法 JSON 才返回数组,否则返回 null(降级回 __parseError)。
 *  忽略字符串内部的 { } (引号 / 转义状态机)。 */
function trySplitConcatenatedJSON(raw: string): unknown[] | null {
  const s = raw.trim();
  if (!s || !s.includes('}{')) return null;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        parts.push(s.slice(start, i + 1));
        // skip whitespace between objects
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        start = j;
        i = j - 1;
      }
    }
  }
  if (parts.length < 2 || start < s.length) return null; // 收尾不干净
  try {
    return parts.map((p) => JSON.parse(p));
  } catch {
    return null;
  }
}
