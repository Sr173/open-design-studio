/* LLMProvider interface — 前端只持接口,实现在 clientProvider.ts(走后端 SSE)
 *
 * 后端拥有 system prompt + key + 上游 SDK,前端只发 messages + tools
 */

import type { Block } from '../store/db';

export interface ChatToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  blocks: Block[];
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | 'unknown';

export type Delta =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args'; id: string; chunk: string }
  | { type: 'tool_call_end'; id: string };

export interface ChatRequest {
  messages: ProviderMessage[];
  tools: ChatToolDef[];
  signal: AbortSignal;
  onDelta: (d: Delta) => void;
  maxTokens?: number;
}

export interface ChatResponse {
  stopReason: StopReason;
  blocks: Block[];
}

export interface LLMProvider {
  readonly name: 'anthropic' | 'openai';
  chat(req: ChatRequest): Promise<ChatResponse>;
}
