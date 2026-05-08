/* 前端 LLMProvider 实现 — fetch SSE 到后端 /api/llm/chat
 *
 * 后端注入 system prompt + key,前端永远拿不到
 */

import type {
  ChatRequest,
  ChatResponse,
  Delta,
  LLMProvider,
} from './provider';

export class ClientProvider implements LLMProvider {
  readonly name = 'openai' as const; // 占位 — 实际 provider 在后端决定

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const resp = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        messages: req.messages,
        tools: req.tools,
        maxTokens: req.maxTokens,
      }),
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`/api/llm/chat ${resp.status}: ${text}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: ChatResponse | null = null;
    let aborted = false;
    let serverError: { message: string; status?: number } | null = null;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 按 \n\n 分块
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseSSE(raw);
          if (!ev) continue;
          if (ev.event === 'delta' && ev.data) {
            try {
              const d: Delta = JSON.parse(ev.data);
              req.onDelta(d);
            } catch {}
          } else if (ev.event === 'final' && ev.data) {
            try {
              final = JSON.parse(ev.data) as ChatResponse;
            } catch {}
          } else if (ev.event === 'aborted') {
            aborted = true;
          } else if (ev.event === 'error' && ev.data) {
            try {
              serverError = JSON.parse(ev.data);
            } catch {
              serverError = { message: ev.data };
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    if (aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (serverError) {
      throw new Error(
        `LLM error${serverError.status ? ` (${serverError.status})` : ''}: ${serverError.message}`
      );
    }
    if (!final) {
      throw new Error('LLM stream ended without final event');
    }
    return final;
  }
}

interface SSEEvent {
  event?: string;
  data?: string;
}

function parseSSE(block: string): SSEEvent | null {
  const lines = block.split('\n');
  const out: SSEEvent = {};
  let dataLines: string[] = [];
  for (const ln of lines) {
    if (ln.startsWith('event:')) out.event = ln.slice(6).trim();
    else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trim());
  }
  if (dataLines.length) out.data = dataLines.join('\n');
  return out.event || out.data ? out : null;
}

// === 拿后端 config(给 ModelSettings 显示) ===
export interface ServerConfigInfo {
  provider: 'anthropic' | 'openai';
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
}

export async function fetchServerConfig(): Promise<ServerConfigInfo | null> {
  try {
    const r = await fetch('/api/llm/config');
    if (!r.ok) return null;
    return (await r.json()) as ServerConfigInfo;
  } catch {
    return null;
  }
}
