/* keychain — keytar wrap,OS 钥匙串存 API key
 *
 * Service 名固定 'ai-design';Account 用 provider 名(anthropic / openai / openai-spec / ...)
 * key 永远不出 main process;每次 chat 调用前由 main 用 key 现 spawn provider 后立即释放引用
 */

import keytar from 'keytar';

const SERVICE = 'ai-design';

export async function getKey(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, account);
  } catch (e) {
    console.error('[keychain] getKey failed', e);
    return null;
  }
}

export async function setKey(account: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, value);
}

export async function deleteKey(account: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, account);
}

export async function listAccounts(): Promise<Array<{ account: string; hasValue: boolean }>> {
  try {
    const creds = await keytar.findCredentials(SERVICE);
    return creds.map((c) => ({ account: c.account, hasValue: !!c.password }));
  } catch {
    return [];
  }
}
