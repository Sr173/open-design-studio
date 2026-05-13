/* 与前端共享的归一化类型(只在协议层用) */

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | Block[];
      is_error?: boolean;
    }
  | { type: 'image'; source: { mediaType: string; data: string } };

export interface ProviderMessage {
  role: 'user' | 'assistant';
  blocks: Block[];
}

export interface ChatToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | 'unknown';

export type Delta =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args'; id: string; chunk: string }
  | { type: 'tool_call_end'; id: string };

export interface ChatRequest {
  /** 前端不传 system — 后端注入 */
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

export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
  /** API key 或 OAuth access_token(根据 authMode 区分用法) */
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** 'apikey' = 走 X-API-Key;'oauth' = 走 Authorization Bearer + anthropic-beta oauth header */
  authMode?: 'apikey' | 'oauth';
  /** Codex 专用:从 id_token JWT 解出的 chatgpt_account_id,要塞 ChatGPT-Account-ID header */
  accountId?: string;
  /** Codex 专用:x-codex-installation-id,本机持久 UUID(electron userData 里) */
  installationId?: string;
}

export interface LLMProvider {
  readonly name: 'anthropic' | 'openai' | 'gemini' | 'codex';
  chat(req: ChatRequest, system: string): Promise<ChatResponse>;
}

export interface ServerConfig {
  provider: 'anthropic' | 'openai' | 'gemini' | 'codex';
  model: string;
  baseUrl?: string;
  port: number;
}
