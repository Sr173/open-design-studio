/* Provider preset 表 — UI 下拉用
 *
 * 每个 preset:
 *  - id:稳定 key,UI 存这个
 *  - label:下拉显示
 *  - provider:走哪个 SDK ('anthropic' | 'openai' | 'gemini')
 *  - baseUrl:auto-fill 进 Settings(可被用户覆盖)
 *  - models:推荐 model list(下拉)+ "custom..." 兜底
 *  - notes:UI 副标题提示
 *
 * 用户选 `custom-gateway` → 全字段自填(任何 CRS / sub2api / 自建网关)
 */

export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

export interface ProviderPreset {
  id: string;
  label: string;
  provider: LLMProvider;
  baseUrl?: string; // undefined = SDK default
  models: string[]; // first is default
  notes?: string;
  category: 'official' | 'gateway' | 'local' | 'custom';
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ─── OAuth (subscription login) ───
  {
    id: 'anthropic-oauth',
    label: 'Claude (订阅登录 · OAuth)',
    provider: 'anthropic',
    models: [
      'claude-opus-4-7-20251004',
      'claude-opus-4-7',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ],
    notes: '用 Claude Pro / Team / Enterprise 订阅,走 Claude Code 凭据',
    category: 'official',
  },
  {
    id: 'openai-oauth-codex',
    label: 'ChatGPT (订阅登录 · Codex OAuth)',
    provider: 'openai',
    // Codex 走的是 ChatGPT 后端,baseURL 与官方 API 不同
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    models: ['gpt-5', 'gpt-5-codex'],
    notes: '用 ChatGPT Plus / Team 订阅,走 Codex CLI 凭据(实验)',
    category: 'official',
  },

  // ─── Official (API key) ───
  {
    id: 'anthropic-official',
    label: 'Anthropic Official',
    provider: 'anthropic',
    models: [
      'claude-opus-4-7-20251004',
      'claude-opus-4-7',
      'claude-opus-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-7-sonnet-20250219',
    ],
    notes: 'console.anthropic.com — 官方 API,推荐 Opus 4.7',
    category: 'official',
  },
  {
    id: 'openai-official',
    label: 'OpenAI Official',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o1-mini',
      'o3-mini',
      'gpt-4.1',
      'gpt-4-turbo',
    ],
    notes: 'platform.openai.com',
    category: 'official',
  },
  {
    id: 'gemini-aistudio',
    label: 'Google Gemini (AI Studio)',
    provider: 'gemini',
    models: [
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash',
    ],
    notes: 'aistudio.google.com — free tier 慷慨',
    category: 'official',
  },

  // ─── Gateways (OpenAI-spec compatible) ───
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    notes: '便宜,reasoner 是 DeepSeek-R1',
    category: 'gateway',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    provider: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    notes: 'platform.moonshot.cn',
    category: 'gateway',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-4o',
      'google/gemini-2.0-flash-exp',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    notes: 'openrouter.ai — 一个 key 调所有模型',
    category: 'gateway',
  },
  {
    id: 'groq',
    label: 'Groq (fast inference)',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'mixtral-8x7b-32768',
    ],
    notes: 'console.groq.com — 极快,llama 系列',
    category: 'gateway',
  },
  {
    id: 'together',
    label: 'Together AI',
    provider: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V3',
    ],
    notes: 'api.together.xyz',
    category: 'gateway',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    provider: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    notes: 'console.mistral.ai',
    category: 'gateway',
  },
  {
    id: 'uniapi',
    label: 'uniapi (中转)',
    provider: 'openai',
    baseUrl: 'https://api.uniapi.io/v1',
    models: [
      'claude-opus-4-7',
      'claude-sonnet-4-5-20250929',
      'gpt-4o',
      'gemini-2.0-flash-exp',
    ],
    notes: '国内中转,跨厂统一计费',
    category: 'gateway',
  },
  {
    id: 'uniapi-anthropic',
    label: 'uniapi (Anthropic 端)',
    provider: 'anthropic',
    baseUrl: 'https://api.uniapi.io',
    models: ['claude-opus-4-7', 'claude-sonnet-4-5-20250929'],
    notes: '走 Anthropic 原生 API 格式(/v1/messages)',
    category: 'gateway',
  },

  // ─── Local ───
  {
    id: 'ollama',
    label: 'Ollama (local)',
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      'qwen2.5-coder:32b',
      'llama3.3:70b',
      'deepseek-r1:32b',
      'qwen2.5:14b',
    ],
    notes: 'ollama.ai — 本机跑,API key 任意填',
    category: 'local',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    provider: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    models: ['local-model'],
    notes: 'lmstudio.ai — 本机 GUI,API key 任意填',
    category: 'local',
  },

  // ─── Custom ───
  {
    id: 'custom-openai',
    label: 'Custom OpenAI-spec gateway',
    provider: 'openai',
    models: [],
    notes: '任何 OpenAI-spec 兼容端点(CRS / sub2api / 自建网关)',
    category: 'custom',
  },
  {
    id: 'custom-anthropic',
    label: 'Custom Anthropic-spec gateway',
    provider: 'anthropic',
    models: [],
    notes: '任何 Anthropic-spec 兼容端点',
    category: 'custom',
  },
];

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function inferPresetIdFromConfig(
  provider: LLMProvider,
  baseUrl: string | null
): string {
  for (const p of PROVIDER_PRESETS) {
    if (p.provider !== provider) continue;
    if (!p.baseUrl && !baseUrl) return p.id; // both undefined / null
    if (p.baseUrl === baseUrl) return p.id;
  }
  // 没匹配 → custom
  return provider === 'anthropic' ? 'custom-anthropic' : 'custom-openai';
}
