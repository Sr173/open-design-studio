/* installation_id — 给 Codex x-codex-installation-id header 用
 *
 * 首次启动生成 UUID 存 userData/installation-id.txt,以后复用
 * 跟 Codex CLI 行为一致:每个 install 持久稳定的标识
 */

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let cached: string | null = null;

export function getInstallationId(): string {
  if (cached) return cached;
  const file = join(app.getPath('userData'), 'installation-id.txt');
  if (existsSync(file)) {
    try {
      const v = readFileSync(file, 'utf8').trim();
      if (v && /^[a-f0-9-]{32,36}$/i.test(v)) {
        cached = v;
        return v;
      }
    } catch { /* fall through */ }
  }
  const id = randomUUID();
  try {
    writeFileSync(file, id, { encoding: 'utf8' });
  } catch (e) {
    console.warn('[installationId] 写 installation-id.txt 失败,本次只在内存里', e);
  }
  cached = id;
  return id;
}
