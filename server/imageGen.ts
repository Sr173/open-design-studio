/* Image generation backend
 *
 * 支持 OpenAI 规范的 /v1/images/generations endpoint(各兼容网关一致):
 *   - OpenAI 官方:gpt-image-1 / dall-e-3 / dall-e-2
 *   - 阿里通义万相(走 dashscope OpenAI-compat 网关):wanx-v1 / wan2.2 系列
 *   - Replicate / Together / 任意 OpenAI-compat 网关
 *
 * 调用接口:
 *   POST <baseUrl>/images/generations
 *   { model, prompt, size?, n?, response_format: 'b64_json', quality?, style? }
 *   → { data: [{ b64_json: '...', revised_prompt?: '...' }] }
 *
 * provider 各家在 quality / style / response_format 上可能略不同,先按 OpenAI 标准实现
 */

export interface ImageProviderConfig {
  /** OpenAI-compat 兼容网关的 base URL,默认 OpenAI 官方 */
  baseUrl?: string;
  /** API key — 跟 LLM 是不同 account 的 keychain 条目 */
  apiKey: string;
  /** 默认 model,可被 generate 调用时 override */
  model: string;
}

export interface GenerateImageInput {
  prompt: string;
  /** OpenAI 标准三档:1024x1024 / 1024x1792 / 1792x1024;某些 provider 支持更多 */
  size?: '1024x1024' | '1024x1792' | '1792x1024' | '1536x1024' | '1024x1536' | string;
  /** OpenAI standard / high(gpt-image-1)或 dall-e-3 standard / hd */
  quality?: 'standard' | 'high' | 'hd' | 'auto';
  /** OpenAI dall-e-3 natural / vivid */
  style?: 'natural' | 'vivid';
  /** override 默认 model */
  model?: string;
  /** 生成几张(默认 1)*/
  n?: number;
}

export interface GenerateImageResult {
  /** PNG base64(不含 data: 前缀) */
  images: string[];
  /** provider 可能回传修改后的 prompt(dall-e-3 会自动改 prompt) */
  revisedPrompt?: string;
  /** 估算成本(USD),仅 OpenAI 官方 pricing 可计算 */
  estimatedCost?: number;
  /** 实际用的 model 名 */
  model: string;
}

/** OpenAI 官方价格表(2025-2026 当前,US dollar / image,1024x1024)
 *  注意:gpt-image-1 按 token 算更准确,这里给保守估算 */
const PRICE_USD: Record<string, { standard: number; high: number }> = {
  'gpt-image-1': { standard: 0.04, high: 0.17 },
  'dall-e-3': { standard: 0.04, high: 0.08 },
  'dall-e-2': { standard: 0.02, high: 0.02 },
};

function estimateCost(model: string, quality: 'standard' | 'high' | 'hd' | 'auto' | undefined, n: number): number | undefined {
  const p = PRICE_USD[model];
  if (!p) return undefined;
  const q = quality === 'high' || quality === 'hd' ? 'high' : 'standard';
  return p[q] * (n || 1);
}

/** 调上游 image gen API,返回 base64 PNGs */
export async function generateImage(
  cfg: ImageProviderConfig,
  input: GenerateImageInput,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/images/generations`;
  const model = input.model ?? cfg.model;
  const body: Record<string, any> = {
    model,
    prompt: input.prompt,
    n: input.n ?? 1,
    response_format: 'b64_json',
  };
  if (input.size) body.size = input.size;
  if (input.quality) body.quality = input.quality;
  if (input.style) body.style = input.style;

  console.log('[image-gen] →', {
    url,
    model,
    size: body.size,
    quality: body.quality,
    promptLen: input.prompt.length,
    n: body.n,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Image gen API ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as any;
  // OpenAI 标准 { data: [{ b64_json, revised_prompt? }] }
  const data = Array.isArray(json.data) ? json.data : [];
  const images: string[] = [];
  let revisedPrompt: string | undefined;
  for (const item of data) {
    if (typeof item?.b64_json === 'string') images.push(item.b64_json);
    if (typeof item?.revised_prompt === 'string') revisedPrompt = item.revised_prompt;
  }
  if (images.length === 0) {
    throw new Error('Image gen API 返回空,没生成任何图');
  }
  return {
    images,
    revisedPrompt,
    estimatedCost: estimateCost(model, input.quality, body.n),
    model,
  };
}
