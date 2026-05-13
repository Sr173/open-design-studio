import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { CodexProvider } from './codex.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export function createProvider(cfg: ProviderConfig): LLMProvider {
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg);
  if (cfg.provider === 'gemini') return new GeminiProvider(cfg);
  if (cfg.provider === 'codex') return new CodexProvider(cfg);
  return new OpenAIProvider(cfg);
}
