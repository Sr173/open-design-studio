/* Gemini provider — Node 端
 *
 * 用 @google/genai 官方 SDK。Gemini 用 "contents" + "parts" 结构,与 Anthropic 的 messages
 * + blocks 不一样,这里做 adapter:
 *
 *   ProviderMessage.blocks  ↔  Gemini Content.parts
 *
 * tool use:
 *   Gemini 用 FunctionDeclaration / FunctionCall / FunctionResponse
 *   我们的 tool_use 对应 functionCall part,tool_result 对应 functionResponse part
 *
 * streaming:
 *   SDK 返回 AsyncIterable<GenerateContentResponse>;chunk 含 candidates[0].content.parts[]
 *   我们逐 part 映射成 Delta (text / tool_call_start / tool_call_args / tool_call_end)
 */

import { GoogleGenAI, type Content, type Part, type Tool } from '@google/genai';
import type {
  Block,
  ChatRequest,
  ChatResponse,
  ChatToolDef,
  Delta,
  LLMProvider,
  ProviderConfig,
  StopReason,
} from './types.js';
import { randomBytes } from 'node:crypto';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;
  private model: string;

  constructor(cfg: ProviderConfig) {
    // baseUrl 用户自定义时(很少见,Gemini 通常直连 generativelanguage.googleapis.com)
    this.client = new GoogleGenAI({
      apiKey: cfg.apiKey,
      // SDK 暂不支持 baseURL override(2.x);如需走中转,要换 OpenAI-spec 端点(走 openai provider)
    });
    this.model = cfg.model;
  }

  async chat(req: ChatRequest, system: string): Promise<ChatResponse> {
    // 1. 把 ProviderMessage[] → Gemini Content[]
    const contents: Content[] = req.messages.map(blocksToGeminiContent);

    // 2. tools 转换
    const geminiTools: Tool[] = req.tools.length
      ? [
          {
            functionDeclarations: req.tools.map(toGeminiFunctionDecl),
          },
        ]
      : [];

    console.log('[gemini] →', {
      model: this.model,
      systemChars: system.length,
      msgCount: contents.length,
      toolCount: req.tools.length,
      maxTokens: req.maxTokens ?? 8192,
    });

    let stream;
    try {
      stream = await this.client.models.generateContentStream({
        model: this.model,
        contents,
        config: {
          systemInstruction: system,
          tools: geminiTools.length ? geminiTools : undefined,
          maxOutputTokens: req.maxTokens ?? 8192,
          abortSignal: req.signal,
        },
      });
    } catch (e: any) {
      console.error('[gemini] stream-create 失败:', {
        message: e?.message,
        status: e?.status,
        error: e?.error,
      });
      throw e;
    }

    // 3. 流式聚合 + 同时 emit Delta
    const blocks: Block[] = [];
    let finishReason: string | undefined;
    // tool_use 流式重组:gemini 一个 chunk 里 functionCall 通常一次给完(不像 OpenAI 那样 args 流式增量)
    // 但为了跟我们的 Delta 协议一致,统一 emit start + args(整 JSON) + end
    let textBuffer = '';

    try {
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text !== undefined) {
              textBuffer += part.text;
              req.onDelta({ type: 'text', text: part.text });
            } else if (part.functionCall) {
              const id = randomBytes(8).toString('hex');
              const name = part.functionCall.name ?? 'unknown';
              const argsObj = part.functionCall.args ?? {};
              const argsJson = JSON.stringify(argsObj);
              // emit deltas in our protocol
              req.onDelta({ type: 'tool_call_start', id, name });
              req.onDelta({ type: 'tool_call_args', id, chunk: argsJson });
              req.onDelta({ type: 'tool_call_end', id });
              // commit text accumulated so far as a block(顺序保留)
              if (textBuffer) {
                blocks.push({ type: 'text', text: textBuffer });
                textBuffer = '';
              }
              blocks.push({
                type: 'tool_use',
                id,
                name,
                input: argsObj,
              });
            }
          }
        }
        if (candidate?.finishReason) finishReason = candidate.finishReason;
      }
    } catch (e: any) {
      console.error('[gemini] iteration 失败', e);
      throw e;
    }

    // commit 剩余 text
    if (textBuffer) {
      blocks.push({ type: 'text', text: textBuffer });
    }

    return {
      stopReason: mapFinishReason(finishReason),
      blocks,
    };
  }
}

function blocksToGeminiContent(m: { role: 'user' | 'assistant'; blocks: Block[] }): Content {
  const parts: Part[] = [];
  for (const b of m.blocks) {
    if (b.type === 'text') {
      parts.push({ text: b.text });
    } else if (b.type === 'image') {
      parts.push({
        inlineData: {
          mimeType: b.source.mediaType,
          data: b.source.data,
        },
      });
    } else if (b.type === 'tool_use') {
      parts.push({
        functionCall: {
          name: b.name,
          args: b.input as Record<string, unknown>,
        },
      });
    } else if (b.type === 'tool_result') {
      const text =
        typeof b.content === 'string'
          ? b.content
          : (b.content as Block[])
              .map((c) => (c.type === 'text' ? c.text : ''))
              .join('\n');
      // Gemini 的 functionResponse 需要 name(原 tool 名),我们 tool_result 块没存 name
      // 用 tool_use_id 当 name 兜底(Gemini 接受任何 string)
      parts.push({
        functionResponse: {
          name: b.tool_use_id, // 不完美但能跑;后续可在 Block 里加 toolName 字段优化
          response: { content: text },
        },
      });
    }
  }
  if (parts.length === 0) {
    // 空消息 Gemini 会报错,塞一个空 text
    parts.push({ text: '' });
  }
  // Gemini role 是 'user' / 'model';assistant 映射成 'model'
  return {
    role: m.role === 'assistant' ? 'model' : 'user',
    parts,
  };
}

function toGeminiFunctionDecl(t: ChatToolDef): any {
  // Gemini FunctionDeclaration 用 OpenAPI Schema(几乎跟 JSON Schema 一致)
  return {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  };
}

function mapFinishReason(r: string | undefined): StopReason {
  if (!r) return 'unknown';
  // Gemini 用 STOP / MAX_TOKENS / SAFETY / RECITATION / OTHER
  switch (r) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'TOOL_USE': // 不存在,但兜底
      return 'tool_use';
    default:
      return 'unknown';
  }
}
