/* Models 列表缓存 — 拉一次 provider /models endpoint,缓存 24h
 *
 * 缓存 key:`models:<provider>:<baseUrl-or-default>`
 * 注:不带 account/key,因为同 provider+baseUrl 的不同账号 model 列表大概率一样
 *     (有差异时手动点刷新)
 */

import { db } from './db';
import type { LLMProvider } from './db';

const TTL = 24 * 60 * 60 * 1000; // 24 小时

export interface CachedModels {
  models: string[];
  displayNames?: Record<string, string>;
  source: 'api' | 'unsupported';
  fetchedAt: number;
}

function cacheKey(provider: LLMProvider, baseUrl: string | null | undefined): string {
  return `models:${provider}:${baseUrl ?? '<default>'}`;
}

export async function getCachedModels(
  provider: LLMProvider,
  baseUrl: string | null | undefined
): Promise<CachedModels | null> {
  const key = cacheKey(provider, baseUrl);
  const row = await db.settings.where({ key }).first();
  if (!row) return null;
  const v = row.value as CachedModels;
  if (!v?.fetchedAt) return null;
  // 过期数据仍返回(UI 显示 stale 标记),不强制清
  return v;
}

export function isStale(c: CachedModels | null): boolean {
  if (!c) return true;
  return Date.now() - c.fetchedAt > TTL;
}

export async function setCachedModels(
  provider: LLMProvider,
  baseUrl: string | null | undefined,
  data: CachedModels
): Promise<void> {
  const key = cacheKey(provider, baseUrl);
  const existing = await db.settings.where({ key }).first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: data });
  } else {
    await db.settings.add({ key, value: data });
  }
}

export async function clearCachedModels(
  provider: LLMProvider,
  baseUrl: string | null | undefined
): Promise<void> {
  const key = cacheKey(provider, baseUrl);
  await db.settings.where({ key }).delete();
}
