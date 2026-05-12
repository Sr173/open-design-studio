import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export function createProvider(cfg: ProviderConfig): LLMProvider {
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg);
  if (cfg.provider === 'gemini') return new GeminiProvider(cfg);
  return new OpenAIProvider(cfg);
}
