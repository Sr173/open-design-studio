/* 本地加密存储 — userData/secrets.json,绝不触碰 OS Keychain
 *
 * 设计取舍(给读源码的人):
 *   之前用过两版:
 *     v1) keytar → 直接写 macOS Keychain item,每次访问触发系统 ACL 弹框,体感最差
 *     v2) Electron safeStorage → 内部用 Keychain 存 1 个 master key,新 App
 *         签名首次访问仍会弹 1 次(ad-hoc 签名 + 每次重 build 签名变化都触发)
 *   v3 (this) → 纯文件存储,**永不弹密码框**。
 *
 * 安全模型(明示):
 *   - 文件存 userData/secrets.json,JSON 内容是 base64 encoded 的简单 XOR 混淆,
 *     不是真加密。任何拿到这台机器同一 OS 用户权限的人,都能解码出 API key 明文。
 *   - 文件 mode 600(只有当前 OS 用户能读),依赖 OS 文件系统权限
 *   - 这跟 aws cli / gh cli / npm / claude code 的做法一致 — dev 工具习惯
 *   - 如果用户机器被攻破到能读 ~/Library/Application Support/<App>/,
 *     攻击者本来就能装任何东西,API key 暴露不是边际损失
 *
 * 数据格式:
 *   { "v": 2, "obf": <int>, "entries": { account: <obfuscated-base64>, ... } }
 *   obf 是 per-install 随机 byte,跟 secrets.json 一起存(同 hex 字符串就同一份),
 *   实际上是混淆+权限保护组合,不是密码学加密。
 */

import { app } from 'electron';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, renameSync, chmodSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

function secretsFilePath(): string {
  return join(app.getPath('userData'), 'secrets.json');
}

interface SecretsFileV2 {
  v: 2;
  /** per-install random byte, 0-255。XOR 混淆用 */
  obf: number;
  entries: Record<string, string>;
}

function xorObfuscate(plain: string, obf: number): string {
  const buf = Buffer.from(plain, 'utf8');
  for (let i = 0; i < buf.length; i++) buf[i] ^= obf;
  return buf.toString('base64');
}

function xorDeobfuscate(encoded: string, obf: number): string {
  const buf = Buffer.from(encoded, 'base64');
  for (let i = 0; i < buf.length; i++) buf[i] ^= obf;
  return buf.toString('utf8');
}

function readSecrets(): SecretsFileV2 {
  const p = secretsFilePath();
  if (!existsSync(p)) {
    return { v: 2, obf: randomBytes(1)[0]!, entries: {} };
  }
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && typeof parsed.obf === 'number' && parsed.entries) {
      return parsed as SecretsFileV2;
    }
    // 老版本格式(v1 safeStorage)无法迁移 — 用户重新输 key
    console.warn('[secureStore] 旧版本 secrets 格式,弃用,新建空容器');
  } catch (e) {
    console.error('[secureStore] 读 secrets.json 失败,丢弃旧数据', e);
  }
  return { v: 2, obf: randomBytes(1)[0]!, entries: {} };
}

function writeSecrets(data: SecretsFileV2): void {
  const p = secretsFilePath();
  mkdirSync(dirname(p), { recursive: true });
  // 原子写:.tmp 再 rename
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, p);
  // chmod 600 — 只有当前 user 能读写(Windows 上 chmod 是 no-op,但 ACL 默认就限到当前用户)
  try {
    chmodSync(p, 0o600);
  } catch (e) {
    console.warn('[secureStore] chmod 600 失败(Windows 上正常)', (e as Error).message);
  }
}

export async function getKey(account: string): Promise<string | null> {
  try {
    const data = readSecrets();
    const enc = data.entries[account];
    if (!enc) return null;
    return xorDeobfuscate(enc, data.obf);
  } catch (e) {
    console.error(`[secureStore] getKey(${account}) 失败`, e);
    return null;
  }
}

export async function setKey(account: string, value: string): Promise<void> {
  const data = readSecrets();
  data.entries[account] = xorObfuscate(value, data.obf);
  writeSecrets(data);
}

export async function deleteKey(account: string): Promise<boolean> {
  const data = readSecrets();
  if (!(account in data.entries)) return false;
  delete data.entries[account];
  writeSecrets(data);
  return true;
}

export async function listAccounts(): Promise<Array<{ account: string; hasValue: boolean }>> {
  const data = readSecrets();
  return Object.entries(data.entries).map(([account, value]) => ({
    account,
    hasValue: !!value,
  }));
}

/** 返回 secrets 文件路径(给设置面板显示) */
export function getStorePath(): string {
  return secretsFilePath();
}
