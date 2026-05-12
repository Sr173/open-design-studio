/* 启动时:读 active profile + keychain key → IPC 让 server 重建 provider
 *
 * 没 active profile → server 用 .env(fallback)
 * 没 keychain key → fail-open(server 继续用 .env)
 */

import { native, isElectron } from '../native';
import { getActiveProfileId, listProfiles } from './profiles';

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
}
