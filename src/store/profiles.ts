/* Profile 系统 — Sprint H
 *
 * Profile = (preset, model, baseUrl override) 命名快捷方式
 * key 是 presetId(主键),同 preset 多次保存覆盖
 * key 存 keychain account = preset.id
 *
 * 主要数据存 IDB settings 表的 'profiles' / 'activeProfileId' 两条记录
 */

import { db, type LLMProvider } from './db';

export interface ModelProfile {
  presetId: string;       // 主键
  name: string;           // 用户起的名(默认 = preset.label)
  provider: LLMProvider;
  model: string;
  baseUrl: string | null; // null = SDK 默认
  createdAt: number;
  updatedAt: number;
}

const KEY_PROFILES = 'profiles';
const KEY_ACTIVE = 'activeProfileId';

export async function listProfiles(): Promise<ModelProfile[]> {
  const row = await db.settings.where({ key: KEY_PROFILES }).first();
  return (row?.value as ModelProfile[]) ?? [];
}

export async function getActiveProfileId(): Promise<string | null> {
  const row = await db.settings.where({ key: KEY_ACTIVE }).first();
  return (row?.value as string) ?? null;
}

export async function setActiveProfile(presetId: string): Promise<void> {
  const existing = await db.settings.where({ key: KEY_ACTIVE }).first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: presetId });
  } else {
    await db.settings.add({ key: KEY_ACTIVE, value: presetId });
  }
}

export async function saveProfile(p: Omit<ModelProfile, 'createdAt' | 'updatedAt'>): Promise<void> {
  const list = await listProfiles();
  const now = Date.now();
  const idx = list.findIndex((x) => x.presetId === p.presetId);
  const full: ModelProfile = {
    ...p,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = full;
  else list.push(full);

  const existing = await db.settings.where({ key: KEY_PROFILES }).first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: list });
  } else {
    await db.settings.add({ key: KEY_PROFILES, value: list });
  }
}

export async function deleteProfile(presetId: string): Promise<void> {
  const list = await listProfiles();
  const next = list.filter((x) => x.presetId !== presetId);
  const existing = await db.settings.where({ key: KEY_PROFILES }).first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: next });
  }
  // 如果删的是 active,清空 active
  const active = await getActiveProfileId();
  if (active === presetId) {
    const row = await db.settings.where({ key: KEY_ACTIVE }).first();
    if (row?.id != null) await db.settings.update(row.id, { value: null });
  }
}
