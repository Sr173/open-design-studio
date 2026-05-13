/* 安全存储 — 用 Electron safeStorage 加密 + 文件持久化,替代 keytar
 *
 * 为什么不再用 keytar:
 *   - keytar 直接写 macOS Keychain item,每次访问触发系统 ACL 弹框
 *   - 每次 App 二进制签名变了(重装新版本)旧 "Always Allow" 失效
 *   - keytar 是 native binding,需要 electron-rebuild,跨架构打包麻烦
 *
 * 用 safeStorage 的好处:
 *   - Electron 内置 API,无 native rebuild
 *   - macOS:用一个 app-specific Keychain item 存 master key,系统识别为
 *     app 自己的数据,默认不弹密码框
 *   - Windows:DPAPI(per-user 加密)
 *   - Linux:libsecret / kwallet
 *   - 我们的 secret 用 master key 加密后写文件,任何人 cat 都是乱码
 *
 * 数据存在 userData/secrets.dat,格式:
 *   { "v": 1, "entries": { "<account>": "<base64-of-encrypted-bytes>", ... } }
 *
 * 兼容性:对外 API 跟 keychain.ts 完全一致,renderer 代码不动
 */

import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function secretsFilePath(): string {
  return join(app.getPath('userData'), 'secrets.dat');
}

interface SecretsFileV1 {
  v: 1;
  entries: Record<string, string>; // account → base64(encrypted bytes)
}

function readSecrets(): SecretsFileV1 {
  const p = secretsFilePath();
  if (!existsSync(p)) return { v: 1, entries: {} };
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1 && parsed.entries && typeof parsed.entries === 'object') {
      return parsed as SecretsFileV1;
    }
  } catch (e) {
    console.error('[secureStore] 读 secrets.dat 失败,丢弃旧数据', e);
  }
  return { v: 1, entries: {} };
}

function writeSecrets(data: SecretsFileV1): void {
  const p = secretsFilePath();
  mkdirSync(dirname(p), { recursive: true });
  // 原子写:先写 .tmp 再 rename,防止崩溃时文件被截断
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  // rename 在同盘是原子的
  const { renameSync } = require('node:fs') as typeof import('node:fs');
  renameSync(tmp, p);
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage 不可用 — Linux 下需要 GNOME Keyring / KWallet;macOS / Windows 应当自动可用。'
    );
  }
}

export async function getKey(account: string): Promise<string | null> {
  try {
    assertEncryptionAvailable();
    const data = readSecrets();
    const enc = data.entries[account];
    if (!enc) return null;
    const buf = Buffer.from(enc, 'base64');
    return safeStorage.decryptString(buf);
  } catch (e) {
    console.error(`[secureStore] getKey(${account}) 失败`, e);
    return null;
  }
}

export async function setKey(account: string, value: string): Promise<void> {
  assertEncryptionAvailable();
  const data = readSecrets();
  const buf = safeStorage.encryptString(value);
  data.entries[account] = buf.toString('base64');
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
