/* 模型设置
 *
 * 浏览器模式:从 /api/llm/config 拿 server 当前配置(只读展示);改配置改 .env 重启
 * Electron 模式:可编辑 provider / model / baseUrl / API Key;key 走 keytar 存 OS 钥匙串,
 *                保存时调 provider:update 通知 main 重建 LLM client
 */

import { useEffect, useState } from 'react';
import { fetchServerConfig, type ServerConfigInfo } from '../llm/clientProvider';
import { isElectron, native } from '../native';

export interface ModelSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ModelSettings({ open, onClose }: ModelSettingsProps) {
  const [cfg, setCfg] = useState<ServerConfigInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchServerConfig().then((c) => {
      setCfg(c);
      setLoading(false);
    });
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--sp-5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '100%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-4)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>模型设置</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            ✕
          </button>
        </div>

        {loading && <div style={{ color: 'var(--text-tertiary)' }}>loading…</div>}

        {!loading && !cfg && (
          <div style={{ color: 'var(--error)', lineHeight: 1.6 }}>
            ✕ 后端未连通(/api/llm/config 失败)
          </div>
        )}

        {!loading && cfg && isElectron() && (
          <ElectronEditor
            current={cfg}
            onSaved={async () => {
              const c = await fetchServerConfig();
              setCfg(c);
            }}
          />
        )}

        {!loading && cfg && !isElectron() && (
          <BrowserReadonly cfg={cfg} />
        )}
      </div>
    </div>
  );
}

/** Electron 模式 — 可编辑 + 写入 keychain */
function ElectronEditor({
  current,
  onSaved,
}: {
  current: ServerConfigInfo;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>(current.provider);
  const [model, setModel] = useState(current.model);
  const [baseUrl, setBaseUrl] = useState(current.baseUrl ?? '');
  const [account, setAccount] = useState(current.provider); // keychain account 名,默认跟 provider 同名
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const n = native();
    if (!n) return;
    n.keychain.get(account).then((v) => setHasStoredKey(!!v));
  }, [account]);

  async function save() {
    setError(null);
    setMsg(null);
    const n = native();
    if (!n) return;
    setSaving(true);
    try {
      // 1. 如果用户输入了新 key,写入 keychain
      if (apiKey.trim()) {
        await n.keychain.set(account, apiKey.trim());
        setHasStoredKey(true);
      } else if (!hasStoredKey) {
        setError('请输入 API Key(还没存过)');
        setSaving(false);
        return;
      }
      // 2. 通知 main 重建 provider
      await n.provider.update({
        provider,
        account,
        model,
        baseUrl: baseUrl.trim() || undefined,
      });
      setMsg('✓ 已保存并切换');
      setApiKey('');
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Field label="Provider">
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as 'anthropic' | 'openai';
            setProvider(p);
            if (account === current.provider) setAccount(p);
          }}
          style={selectStyle}
        >
          <option value="openai">openai (含 OpenAI / DeepSeek / Moonshot / 中转 等)</option>
          <option value="anthropic">anthropic</option>
        </select>
      </Field>

      <Field label="Model">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={provider === 'anthropic' ? 'claude-sonnet-4-5-20250929' : 'gpt-4o / gpt-5.5 / ...'}
          style={inputStyle}
        />
      </Field>

      <Field label="Base URL">
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="留空 = SDK 默认;或写 https://api.uniapi.io/v1 / http://cr.killvxk.com:58080/openai/v1"
          style={inputStyle}
        />
      </Field>

      <Field label={`API Key (Keychain account: ${account})`}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasStoredKey ? '已存(留空保留当前)' : '粘贴 key'}
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {hasStoredKey ? '✓ 已存在系统钥匙串' : '✕ 还没存过 — 请输入'}
        </div>
      </Field>

      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      {msg && <div style={{ color: 'var(--success, #4ade80)', fontSize: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        API Key 通过 OS 钥匙串保存(macOS Keychain / Windows DPAPI / Linux libsecret)。
        卸载 App 后 key 不会自动删除,可在系统钥匙串管理工具里手动清掉(service: <Mono>ai-design</Mono>)。
      </div>
    </>
  );
}

/** 浏览器模式 — 只读 */
function BrowserReadonly({ cfg }: { cfg: ServerConfigInfo }) {
  return (
    <>
      <Field label="Provider">
        <Mono>{cfg.provider}</Mono>
      </Field>
      <Field label="Model">
        <Mono>{cfg.model}</Mono>
      </Field>
      <Field label="Base URL">
        <Mono>{cfg.baseUrl ?? '(SDK 默认)'}</Mono>
      </Field>
      <Field label="API Key">
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            color: cfg.hasKey ? 'var(--success)' : 'var(--error)',
          }}
        >
          {cfg.hasKey ? '✓ 已配置(在后端 .env)' : '✕ 未配置 — chat 会失败'}
        </span>
      </Field>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        浏览器模式:改配置请编辑项目根 <Mono>.env</Mono>,然后重启 <Mono>pnpm dev</Mono>。
        Electron 套壳下可直接在此界面改并存到 OS 钥匙串。
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-primary)',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const btnPrimary: React.CSSProperties = {
  padding: '6px 16px',
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
