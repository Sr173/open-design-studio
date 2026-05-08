import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export function createProvider(cfg: ProviderConfig): LLMProvider {
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg);
  return new OpenAIProvider(cfg);
}
