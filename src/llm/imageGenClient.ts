/* Image gen 客户端 — 调 server /api/image/generate
 *
 * 渲染端入口,被 generate_image 工具调用 + 设置面板 image config 状态读
 */

import { apiFetch } from '../native';

export interface ImageConfigInfo {
  hasKey: boolean;
  model: string | null;
  baseUrl: string | null;
}

export interface GenerateImageInput {
  prompt: string;
  size?: string;
  quality?: 'standard' | 'high' | 'hd' | 'auto';
  style?: 'natural' | 'vivid';
  model?: string;
  n?: number;
}

export interface GenerateImageResult {
  images: string[]; // base64 PNG 数组
  revisedPrompt?: string;
  estimatedCost?: number;
  model: string;
}

export async function fetchImageConfig(): Promise<ImageConfigInfo | null> {
  try {
    const r = await apiFetch('/api/image/config');
    if (!r.ok) return null;
    return (await r.json()) as ImageConfigInfo;
  } catch {
    return null;
  }
}

export async function generateImage(input: GenerateImageInput, signal?: AbortSignal): Promise<GenerateImageResult> {
  const r = await apiFetch('/api/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.error ?? text; } catch {}
    throw new Error(`image gen ${r.status}: ${msg}`);
  }
  return JSON.parse(text) as GenerateImageResult;
}
