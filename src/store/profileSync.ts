/* 启动时:读 active profile + keychain key → IPC 让 server 重建 provider
 *
 * 没 active profile → server 用 .env(fallback)
 * 没 keychain key → fail-open(server 继续用 .env)
 *
 * 同时还会 sync image provider 配置(独立于 LLM provider,各自记忆)
 */

import { native, isElectron } from '../native';
import { getActiveProfileId, listProfiles } from './profiles';
import { db } from './db';

const KEY_IMAGE_CONFIG = 'imageProvider';

interface PersistedImageProvider {
  presetId: string;       // 'openai-image' / 'dashscope' / ...
  model: string;
  baseUrl: string | null;
}

export async function saveImageProvider(cfg: PersistedImageProvider): Promise<void> {
  const existing = await db.settings.where({ key: KEY_IMAGE_CONFIG }).first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: cfg });
  } else {
    await db.settings.add({ key: KEY_IMAGE_CONFIG, value: cfg });
  }
}

export async function getImageProvider(): Promise<PersistedImageProvider | null> {
  const row = await db.settings.where({ key: KEY_IMAGE_CONFIG }).first();
  return (row?.value as PersistedImageProvider) ?? null;
}

export async function clearImageProvider(): Promise<void> {
  await db.settings.where({ key: KEY_IMAGE_CONFIG }).delete();
}

export async function syncActiveProfileToServer(): Promise<void> {
  if (!isElectron()) return;
  const n = native();
  if (!n) return;

  const activeId = await getActiveProfileId();
  if (!activeId) return;

  const profiles = await listProfiles();
  const profile = profiles.find((p) => p.presetId === activeId);
  if (!profile) return;

  // OAuth profile 跳过 keychain 检查(IPC 路径会去 oauth service 拉 token)
  if (!profile.presetId.startsWith('oauth:')) {
    const key = await n.keychain.get(profile.presetId);
    if (!key) {
      console.warn(`[profileSync] active profile "${profile.name}" 的 key 在 keychain 找不到 — 服务端 fallback 到 .env`);
      return;
    }
  }

  try {
    await n.provider.update({
      provider: profile.provider,
      account: profile.presetId,
      model: profile.model,
      baseUrl: profile.baseUrl || undefined,
    });
    console.log(`[profileSync] 已同步 active profile "${profile.name}" → ${profile.provider} / ${profile.model}`);
  } catch (e) {
    console.warn('[profileSync] provider.update 失败', e);
  }

  // 顺便 sync image provider(独立配置)
  const img = await getImageProvider();
  if (img) {
    try {
      const account = `image:${img.presetId}`;
      const key = await n.keychain.get(account);
      if (!key) {
        console.warn(`[profileSync] image provider "${img.presetId}" 的 key 没找到`);
      } else {
        await n.imageProvider.update({
          account,
          model: img.model,
          baseUrl: img.baseUrl || undefined,
        });
        console.log(`[profileSync] 已同步 image provider → ${img.presetId} / ${img.model}`);
      }
    } catch (e) {
      console.warn('[profileSync] image-provider.update 失败', e);
    }
  }
}
