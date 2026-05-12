/* Anthropic provider — Node 端用 @anthropic-ai/sdk */

import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;
  private model: string;
  private oauth: boolean;

  constructor(cfg: ProviderConfig) {
    this.oauth = cfg.authMode === 'oauth';
    if (this.oauth) {
      // OAuth 模式:用 authToken(Bearer),不带 X-API-Key
      this.client = new Anthropic({
        authToken: cfg.apiKey,
        baseURL: cfg.baseUrl,
      });
    } else {
      this.client = new Anthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
      });
    }
    this.model = cfg.model;
  }

  async chat(req: ChatRequest, system: string): Promise<ChatResponse> {
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: blocksToAnthropicContent(m.blocks),
    }));

    const tools = req.tools.map(toAnthropicTool);

    const reqMeta = {
      model: this.model,
      systemChars: system.length,
      msgCount: messages.length,
      toolCount: tools.length,
      maxTokens: req.maxTokens ?? 128_000,
    };
    console.log('[anthropic] →', reqMeta);

    let stream;
    try {
      stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 128_000,
          system,
          messages,
          tools: tools.length ? tools : undefined,
        },
        {
          signal: req.signal,
          headers: {
            // Opus 4.7 默认 32k 输出;加这个 beta 拉到 128k(uniapi 实测已支持)
            // OAuth 模式额外加 oauth-2025-04-20 让 Claude Code 凭据可用
            'anthropic-beta': this.oauth
              ? 'output-128k-2025-02-19,oauth-2025-04-20'
              : 'output-128k-2025-02-19',
          },
        }
      );
    } catch (e: any) {
      console.error('[anthropic] stream-create 失败:', {
        message: e?.message,
        status: e?.status,
        error: e?.error,
        headers: e?.headers,
      });
      throw e;
    }

    stream.on('streamEvent', (event: any) => {
      handleAnthropicEvent(event, req.onDelta);
    });

    let final;
    try {
      final = await stream.finalMessage();
    } catch (e: any) {
      console.error('[anthropic] finalMessage 失败:', {
        message: e?.message,
        status: e?.status,
        error: e?.error,
        headers: e?.headers,
        rawResponse: e?.response?.headers,
      });
      throw e;
    }

    const blocks = anthropicContentToBlocks(final.content as any[]);
    const stopReason = mapStopReason(final.stop_reason);
    return { stopReason, blocks };
  }
}

function handleAnthropicEvent(event: any, onDelta: (d: Delta) => void) {
  if (event.type === 'content_block_start') {
    const cb = event.content_block;
    if (cb.type === 'tool_use') {
      onDelta({ type: 'tool_call_start', id: cb.id, name: cb.name });
    }
  } else if (event.type === 'content_block_delta') {
    const d = event.delta;
    if (d.type === 'text_delta') {
      onDelta({ type: 'text', text: d.text });
    } else if (d.type === 'input_json_delta') {
      onDelta({ type: 'tool_call_args', id: '', chunk: d.partial_json });
    }
  } else if (event.type === 'content_block_stop') {
    onDelta({ type: 'tool_call_end', id: '' });
  }
}

function blocksToAnthropicContent(blocks: Block[]): any[] {
  return blocks.map((b) => {
    switch (b.type) {
      case 'text':
        return { type: 'text', text: b.text };
      case 'tool_use':
        return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: b.tool_use_id,
          content: typeof b.content === 'string' ? b.content : (b.content as any),
          is_error: b.is_error,
        };
      case 'image':
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: b.source.mediaType,
            data: b.source.data,
          },
        };
    }
  });
}

function anthropicContentToBlocks(content: any[]): Block[] {
  return content.map((c: any) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'tool_use')
      return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
    if (c.type === 'tool_result')
      return {
        type: 'tool_result',
        tool_use_id: c.tool_use_id,
        content: c.content,
        is_error: c.is_error,
      };
    if (c.type === 'image')
      return {
        type: 'image',
        source: { mediaType: c.source.media_type, data: c.source.data },
      };
    return { type: 'text', text: String(c) };
  });
}

function toAnthropicTool(t: ChatToolDef): any {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  };
}

function mapStopReason(r: string | null): StopReason {
  switch (r) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
      return r as StopReason;
    case 'stop_sequence':
      return 'stop';
    default:
      return 'unknown';
  }
}
