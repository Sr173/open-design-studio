/* Image provider preset 表 — image gen UI 下拉用
 *
 * 走 OpenAI 兼容 /v1/images/generations 规范的 provider 都在这里
 * (各大网关基本统一这个协议,差别在 model 名和 quality 选项)
 */

export interface ImageProviderPreset {
  id: string;
  label: string;
  baseUrl?: string;          // undefined = OpenAI 默认
  models: string[];           // 推荐 model
  notes?: string;
  category: 'official' | 'gateway' | 'custom';
}

export const IMAGE_PROVIDER_PRESETS: ImageProviderPreset[] = [
  {
    id: 'openai-image',
    label: 'OpenAI 官方',
    models: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
    notes: 'platform.openai.com — gpt-image-1 最新最强,DALL-E 3 平价好用',
    category: 'official',
  },
  {
    id: 'dashscope',
    label: '阿里通义万相 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx-v1'],
    notes: 'dashscope.aliyuncs.com — 国内速度快,价格便宜',
    category: 'gateway',
  },
  {
    id: 'volcengine-doubao',
    label: '字节火山豆包 (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seedream-3-0-t2i-250415', 'doubao-image-1'],
    notes: '火山方舟 — 国内速度极快,豆包出图风格偏插画',
    category: 'gateway',
  },
  {
    id: 'replicate-flux',
    label: 'Replicate (FLUX / SDXL)',
    baseUrl: 'https://openai-proxy.replicate.com/v1',
    models: ['flux-pro', 'flux-schnell', 'sdxl'],
    notes: 'replicate.com 的 OpenAI 兼容端点。开源模型,无审查',
    category: 'gateway',
  },
  {
    id: 'openrouter-image',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-image-1', 'openai/dall-e-3', 'black-forest-labs/flux-pro'],
    notes: 'openrouter.ai 也支持 image gen,一个 key 调所有',
    category: 'gateway',
  },
  {
    id: 'uniapi-image',
    label: 'uniapi (中转)',
    baseUrl: 'https://api.uniapi.io/v1',
    models: ['gpt-image-1', 'dall-e-3', 'flux-pro'],
    notes: '国内中转跨厂统一计费',
    category: 'gateway',
  },
  {
    id: 'custom-image',
    label: 'Custom OpenAI-spec image endpoint',
    models: [],
    notes: '任何 OpenAI-spec 的 image gen 端点',
    category: 'custom',
  },
];

export function getImagePresetById(id: string): ImageProviderPreset | undefined {
  return IMAGE_PROVIDER_PRESETS.find((p) => p.id === id);
}
