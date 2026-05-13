/* 模型设置 v6.3 — provider preset 下拉 + model 下拉 + profile 切换
 *
 * 体验:
 *   1. Provider preset 下拉(grouped):Anthropic / OpenAI / Gemini / 各 gateway / Custom
 *   2. 选 preset 自动 fill baseUrl + 显示模型下拉
 *   3. Model 下拉(preset 推荐 + Custom 兜底)
 *   4. baseUrl 仅 custom preset 可编辑
 *   5. API key 存 keychain account = preset id
 *   6. 多 profile(Sprint H)— 顶部 profile 列表 + 切换;每个 profile = (preset, model, baseUrl override, label)
 */

import { useEffect, useState } from 'react';
import { fetchServerConfig, type ServerConfigInfo } from '../llm/clientProvider';
import { isElectron, native } from '../native';
import {
  PROVIDER_PRESETS,
  getPresetById,
  inferPresetIdFromConfig,
  type LLMProvider,
  type ProviderPreset,
} from '../llm/providers';
import {
  listProfiles,
  saveProfile,
  setActiveProfile,
  getActiveProfileId,
  deleteProfile,
  type ModelProfile,
} from '../store/profiles';
import { useModelList, mergeModels } from './useModelList';
import {
  IMAGE_PROVIDER_PRESETS,
  getImagePresetById,
  type ImageProviderPreset,
} from '../llm/imageProviders';
import { fetchImageConfig } from '../llm/imageGenClient';
import { saveImageProvider, getImageProvider, clearImageProvider } from '../store/profileSync';

export interface ModelSettingsProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'profile' | 'profiles' | 'oauth' | 'image';

export function ModelSettings({ open, onClose }: ModelSettingsProps) {
  const [cfg, setCfg] = useState<ServerConfigInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchServerConfig().then((c) => {
      setCfg(c);
      setLoading(false);
    });
  }, [open, refreshTick]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>模型设置</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 0, fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        {isElectron() && (
          <div style={tabBar}>
            <button
              onClick={() => setTab('profile')}
              style={{ ...tabBtn, ...(tab === 'profile' ? tabBtnActive : null) }}
            >
              API Key
            </button>
            <button
              onClick={() => setTab('oauth')}
              style={{ ...tabBtn, ...(tab === 'oauth' ? tabBtnActive : null) }}
            >
              订阅登录
            </button>
            <button
              onClick={() => setTab('image')}
              style={{ ...tabBtn, ...(tab === 'image' ? tabBtnActive : null) }}
            >
              Image
            </button>
            <button
              onClick={() => setTab('profiles')}
              style={{ ...tabBtn, ...(tab === 'profiles' ? tabBtnActive : null) }}
            >
              Profiles
            </button>
          </div>
        )}

        {loading && <div style={{ color: 'var(--text-tertiary)' }}>loading…</div>}

        {!loading && !cfg && (
          <div style={{ color: 'var(--error)', lineHeight: 1.6 }}>
            ✕ 后端未连通(/api/llm/config 失败)
          </div>
        )}

        {!loading && cfg && isElectron() && tab === 'profile' && (
          <ElectronEditor
            current={cfg}
            onSaved={() => setRefreshTick((v) => v + 1)}
          />
        )}

        {!loading && cfg && isElectron() && tab === 'oauth' && (
          <OAuthPanel />
        )}

        {!loading && cfg && isElectron() && tab === 'image' && (
          <ImageProviderPanel onSaved={() => setRefreshTick((v) => v + 1)} />
        )}

        {!loading && cfg && isElectron() && tab === 'profiles' && (
          <ProfilesManager
            onActivated={() => setRefreshTick((v) => v + 1)}
          />
        )}

        {!loading && cfg && !isElectron() && <BrowserReadonly cfg={cfg} />}
      </div>
    </div>
  );
}

// ============================================================
// ElectronEditor — provider preset + model 下拉 + key 输入
// ============================================================

function ElectronEditor({
  current,
  onSaved,
}: {
  current: ServerConfigInfo;
  onSaved: () => void;
}) {
  const initialPresetId = inferPresetIdFromConfig(current.provider, current.baseUrl);
  const [presetId, setPresetId] = useState<string>(initialPresetId);
  const preset = getPresetById(presetId) ?? PROVIDER_PRESETS[0];

  const [model, setModel] = useState<string>(current.model);
  const [modelChoice, setModelChoice] = useState<string>(() => {
    // 如果当前 model 在 preset 推荐列表里 → dropdown,否则 'custom'
    return preset.models.includes(current.model) ? current.model : 'custom';
  });
  const [customModelInput, setCustomModelInput] = useState<string>(
    preset.models.includes(current.model) ? '' : current.model
  );

  const [baseUrl, setBaseUrl] = useState<string>(current.baseUrl ?? preset.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [profileName, setProfileName] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 切 preset → 重置 model/baseUrl 到 preset 默认
  useEffect(() => {
    const p = getPresetById(presetId);
    if (!p) return;
    setBaseUrl(p.baseUrl ?? '');
    if (p.models.length > 0) {
      setModelChoice(p.models[0]);
      setModel(p.models[0]);
    } else {
      setModelChoice('custom');
      setCustomModelInput('');
      setModel('');
    }
  }, [presetId]);

  // 同步 model:dropdown 选择 → model state
  useEffect(() => {
    if (modelChoice === 'custom') {
      setModel(customModelInput);
    } else {
      setModel(modelChoice);
    }
  }, [modelChoice, customModelInput]);

  // 查 keychain 是否已有此 preset 的 key
  useEffect(() => {
    const n = native();
    if (!n) return;
    n.keychain.get(presetId).then((v) => setHasStoredKey(!!v));
  }, [presetId, msg]);

  const canEditBaseUrl = preset.category === 'custom' || preset.category === 'local';

  // 动态拉 model 列表 — 只有已存 key 才有意义(否则 IPC 拉不到)
  const ml = useModelList({
    provider: preset.provider,
    account: presetId,
    baseUrl: baseUrl.trim() || preset.baseUrl || null,
    skip: !hasStoredKey || preset.provider === 'codex' || preset.category === 'local',
  });
  const mergedModels = mergeModels(preset.models, ml.apiModels);

  async function save() {
    setError(null);
    setMsg(null);
    const n = native();
    if (!n) return;
    if (!model.trim()) {
      setError('请填 model');
      return;
    }
    setSaving(true);
    try {
      if (apiKey.trim()) {
        await n.keychain.set(presetId, apiKey.trim());
        setHasStoredKey(true);
      } else if (!hasStoredKey) {
        // 某些 local provider(ollama)不需要 key,允许空
        if (preset.category !== 'local') {
          setError('请输入 API Key(还没存过)');
          setSaving(false);
          return;
        }
        // 兜底:写一个 dummy key 让 SDK 不报错
        await n.keychain.set(presetId, 'local-no-key-needed');
      }

      const finalBaseUrl = baseUrl.trim() || preset.baseUrl;
      await n.provider.update({
        provider: preset.provider,
        account: presetId,
        model: model.trim(),
        baseUrl: finalBaseUrl || undefined,
      });

      // 同步存 profile(Sprint H — 隐式 profile,name = preset.label,如果用户没起名)
      await saveProfile({
        name: profileName.trim() || preset.label,
        presetId,
        provider: preset.provider,
        model: model.trim(),
        baseUrl: finalBaseUrl || null,
      });
      await setActiveProfile(presetId); // by presetId(同 preset 多次 save 覆盖)

      setMsg('✓ 已保存并切换');
      setApiKey('');
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // 把 preset 分组
  const grouped = {
    official: PROVIDER_PRESETS.filter((p) => p.category === 'official'),
    gateway: PROVIDER_PRESETS.filter((p) => p.category === 'gateway'),
    local: PROVIDER_PRESETS.filter((p) => p.category === 'local'),
    custom: PROVIDER_PRESETS.filter((p) => p.category === 'custom'),
  };

  return (
    <>
      <Field label="Provider preset">
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          style={selectStyle}
        >
          <optgroup label="── Official ──">
            {grouped.official.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="── Gateways ──">
            {grouped.gateway.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="── Local ──">
            {grouped.local.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="── Custom ──">
            {grouped.custom.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
        </select>
        {preset.notes && (
          <div style={hintStyle}>{preset.notes}</div>
        )}
      </Field>

      <Field label="Model">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={modelChoice}
            onChange={(e) => setModelChoice(e.target.value)}
            style={{ ...selectStyle, flex: 1 }}
          >
            {/* preset 推荐(在前)+ API 拉到的(去重在后)*/}
            {preset.models.length > 0 && (
              <optgroup label={`── 推荐 (${preset.label}) ──`}>
                {preset.models.map((m) => (
                  <option key={`p-${m}`} value={m}>{m}</option>
                ))}
              </optgroup>
            )}
            {ml.apiModels.length > 0 && (
              <optgroup label={`── API 列表 (${ml.source === 'cache' ? '缓存' : '实时'}) ──`}>
                {ml.apiModels
                  .filter((m) => !preset.models.includes(m))
                  .map((m) => (
                    <option key={`a-${m}`} value={m}>
                      {ml.displayNames[m] ? `${m} — ${ml.displayNames[m]}` : m}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="custom">Custom…</option>
          </select>
          <button
            type="button"
            onClick={ml.refresh}
            disabled={ml.loading || !hasStoredKey || preset.provider === 'codex'}
            style={refreshBtnStyle}
            title={
              !hasStoredKey
                ? '需要先存 API key 才能拉列表'
                : preset.provider === 'codex'
                  ? 'Codex 后端不支持列表查询'
                  : ml.loading
                    ? '正在拉取…'
                    : `从 ${preset.label} 重新拉一次 model 列表`
            }
          >
            {ml.loading ? '⟳' : '↻'}
          </button>
        </div>
        {modelChoice === 'custom' && (
          <input
            value={customModelInput}
            onChange={(e) => setCustomModelInput(e.target.value)}
            placeholder="自定义 model 名(完全照搬 provider 的命名)"
            style={{ ...inputStyle, marginTop: 6 }}
          />
        )}
        {mergedModels.length > preset.models.length && (
          <div style={hintStyle}>
            发现 {ml.apiModels.length} 个 API 列表 model
            {ml.fetchedAt && ` · ${formatAgo(ml.fetchedAt)}前拉取`}
          </div>
        )}
        {ml.error && (
          <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
            拉取失败:{ml.error.slice(0, 200)}
          </div>
        )}
      </Field>

      <Field label="Base URL">
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={preset.baseUrl ?? '留空 = SDK 默认'}
          style={inputStyle}
          disabled={!canEditBaseUrl}
        />
        {!canEditBaseUrl && (
          <div style={hintStyle}>preset 锁定,切到 Custom 才能改</div>
        )}
      </Field>

      <Field label={`API Key (Keychain: ${presetId})`}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasStoredKey ? '已存(留空保留当前)' : '粘贴 key'}
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {hasStoredKey
            ? '✓ 已存在系统钥匙串'
            : preset.category === 'local'
            ? '本地 provider 通常无需 key,可留空'
            : '✕ 还没存过 — 请输入'}
        </div>
      </Field>

      <Field label="Profile name(可选)">
        <input
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder={`默认:${preset.label}`}
          style={inputStyle}
        />
        <div style={hintStyle}>
          多账号 / 多组合用?在 "Profiles" tab 管理。
        </div>
      </Field>

      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      {msg && <div style={{ color: 'var(--success, #4ade80)', fontSize: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? '保存中…' : '保存并切换'}
        </button>
      </div>

      <div style={footnoteStyle}>
        API Key 通过 OS 钥匙串保存(每个 preset 一个 account);卸载 App 后可在系统钥匙串管理工具里手动清掉(service: <Mono>ai-design</Mono>)。
      </div>
    </>
  );
}

// ============================================================
// OAuthPanel — Sprint J 订阅账号登录 (Anthropic Console / OpenAI Codex)
// ============================================================

function OAuthPanel() {
  const [st, setSt] = useState<{ anthropic: boolean; openai: boolean }>({ anthropic: false, openai: false });
  const [busy, setBusy] = useState<'anthropic' | 'openai' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 跟踪每个 OAuth provider 当前选的 model(从 IDB profile 读)
  const [models, setModels] = useState<{ anthropic: string; openai: string }>({
    anthropic: '',
    openai: '',
  });

  async function refresh() {
    const n = native();
    if (!n) return;
    const [status, profiles] = await Promise.all([n.oauth.status(), listProfiles()]);
    setSt(status);
    const aProfile = profiles.find((p) => p.presetId === 'oauth:anthropic');
    const oProfile = profiles.find((p) => p.presetId === 'oauth:openai-codex');
    const aPreset = getPresetById('anthropic-oauth')!;
    const oPreset = getPresetById('openai-oauth-codex')!;
    setModels({
      anthropic: aProfile?.model || aPreset.models[0],
      openai: oProfile?.model || oPreset.models[0],
    });
  }
  useEffect(() => { refresh(); }, []);

  /** 写 profile + 推 server。登录后 + 改 model 都走这里。 */
  async function applyProfile(provider: 'anthropic' | 'openai', model: string) {
    const n = native();
    if (!n) return;
    const presetId = provider === 'anthropic' ? 'anthropic-oauth' : 'openai-oauth-codex';
    const preset = getPresetById(presetId)!;
    const account = `oauth:${provider === 'anthropic' ? 'anthropic' : 'openai-codex'}`;
    await saveProfile({
      name: preset.label,
      presetId: account,
      provider: preset.provider,
      model,
      baseUrl: preset.baseUrl ?? null,
    });
    await n.provider.update({
      provider: preset.provider,
      account,
      model,
      baseUrl: preset.baseUrl,
    });
    await setActiveProfile(account);
  }

  async function login(provider: 'anthropic' | 'openai') {
    const n = native();
    if (!n) return;
    setBusy(provider);
    setErr(null);
    setMsg(null);
    try {
      await n.oauth.login(provider);
      await refresh();
      // 登录成功 → 用当前选的 model(默认是 preset.models[0])建 profile + 激活
      const preset = getPresetById(
        provider === 'anthropic' ? 'anthropic-oauth' : 'openai-oauth-codex'
      )!;
      const model = (provider === 'anthropic' ? models.anthropic : models.openai) || preset.models[0];
      await applyProfile(provider, model);
      setMsg('✓ 登录成功 & 已激活');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function changeModel(provider: 'anthropic' | 'openai', model: string) {
    setModels((m) => ({ ...m, [provider]: model }));
    if (!st[provider]) return; // 没登录就不推 server
    setErr(null);
    setMsg(null);
    try {
      await applyProfile(provider, model);
      setMsg(`✓ 已切到 ${model}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function logout(provider: 'anthropic' | 'openai') {
    const n = native();
    if (!n) return;
    if (!confirm(`登出 ${provider}?(token 从钥匙串删除)`)) return;
    await n.oauth.logout(provider);
    refresh();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        用 Claude / ChatGPT 订阅账号直接登录,不用 API key。token 自动 refresh,存 OS 钥匙串。
        <br />
        <span style={{ color: 'var(--accent)' }}>注意</span>:走的是 Claude Code / Codex CLI 的官方 OAuth 端点;用户必须有对应订阅。
      </div>

      <OAuthCard
        oauthProvider="anthropic"
        title="Claude (Anthropic Console)"
        subtitle="Pro / Team / Enterprise · 用 Claude Code 的 OAuth 端点"
        logged={st.anthropic}
        busy={busy === 'anthropic'}
        preset={getPresetById('anthropic-oauth')!}
        selectedModel={models.anthropic}
        onModelChange={(m) => changeModel('anthropic', m)}
        onLogin={() => login('anthropic')}
        onLogout={() => logout('anthropic')}
      />
      <OAuthCard
        oauthProvider="openai"
        title="ChatGPT (OpenAI Codex)"
        subtitle="Plus / Team · 用 Codex CLI 的 OAuth 端点"
        logged={st.openai}
        busy={busy === 'openai'}
        preset={getPresetById('openai-oauth-codex')!}
        selectedModel={models.openai}
        onModelChange={(m) => changeModel('openai', m)}
        onLogin={() => login('openai')}
        onLogout={() => logout('openai')}
      />

      {err && <div style={{ color: 'var(--error)', fontSize: 12 }}>{err}</div>}
      {msg && <div style={{ color: 'var(--success, #4ade80)', fontSize: 12 }}>{msg}</div>}

      <div style={footnoteStyle}>
        登录后:浏览器弹出授权页 → 完成后自动回到 App。token 走本地 callback (http://127.0.0.1:54545 / :1455)
        交换,verifier 永不出本机。
      </div>
    </div>
  );
}

function OAuthCard({
  oauthProvider, title, subtitle, logged, busy, preset, selectedModel,
  onModelChange, onLogin, onLogout,
}: {
  oauthProvider: 'anthropic' | 'openai';
  title: string;
  subtitle: string;
  logged: boolean;
  busy: boolean;
  preset: ProviderPreset;
  selectedModel: string;
  onModelChange(m: string): void;
  onLogin(): void;
  onLogout(): void;
}) {
  const account = `oauth:${oauthProvider === 'anthropic' ? 'anthropic' : 'openai-codex'}`;
  // 动态拉 OAuth 账号能用的 model 列表(Codex/OpenAI 的 ChatGPT backend 返 unsupported)
  const ml = useModelList({
    provider: preset.provider,
    account,
    baseUrl: preset.baseUrl ?? null,
    skip: !logged || preset.provider === 'codex',
  });
  // 显式 mode — 不从 selectedModel 派生,避免点 Custom 时 input 不弹的死锁
  const [mode, setMode] = useState<'list' | 'custom'>(() =>
    selectedModel && !preset.models.includes(selectedModel) ? 'custom' : 'list'
  );
  const [customInput, setCustomInput] = useState(
    selectedModel && !preset.models.includes(selectedModel) ? selectedModel : ''
  );
  // selectedModel 从父组件改变 → 同步本地状态(profile 重新加载等场景)
  useEffect(() => {
    if (!selectedModel) return;
    const known = preset.models.includes(selectedModel) || ml.apiModels.includes(selectedModel);
    if (known) {
      setMode('list');
    } else {
      setMode('custom');
      setCustomInput(selectedModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, preset.models.length, ml.apiModels.length]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: 12,
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{subtitle}</div>
          <div style={{
            fontSize: 11,
            marginTop: 6,
            color: logged ? 'var(--success, #4ade80)' : 'var(--text-disabled)',
          }}>
            {logged ? '● 已登录' : '○ 未登录'}
          </div>
        </div>
        {logged ? (
          <button onClick={onLogout} style={btnSecondary}>登出</button>
        ) : (
          <button onClick={onLogin} disabled={busy} style={btnPrimary}>
            {busy ? '等待授权…' : '登录'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 36 }}>Model</span>
        <select
          value={mode === 'custom' ? 'custom' : selectedModel}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              setMode('custom');
              // 切到 custom 时如果 input 已经有值就 apply,否则让用户输入
              if (customInput.trim()) onModelChange(customInput.trim());
            } else {
              setMode('list');
              onModelChange(v);
            }
          }}
          style={{ ...selectStyle, flex: 1 }}
          disabled={!logged}
          title={logged ? '切换 model 立即生效' : '登录后才能选 model'}
        >
          {preset.models.length > 0 && (
            <optgroup label="── 推荐 ──">
              {preset.models.map((m) => (
                <option key={`p-${m}`} value={m}>{m}</option>
              ))}
            </optgroup>
          )}
          {ml.apiModels.filter((m) => !preset.models.includes(m)).length > 0 && (
            <optgroup label={`── API 列表 (${ml.source === 'cache' ? '缓存' : '实时'}) ──`}>
              {ml.apiModels
                .filter((m) => !preset.models.includes(m))
                .map((m) => (
                  <option key={`a-${m}`} value={m}>
                    {ml.displayNames[m] ? `${m} — ${ml.displayNames[m]}` : m}
                  </option>
                ))}
            </optgroup>
          )}
          <option value="custom">Custom…</option>
        </select>
        <button
          type="button"
          onClick={ml.refresh}
          disabled={ml.loading || !logged || preset.provider === 'codex'}
          style={refreshBtnStyle}
          title={
            !logged
              ? '登录后才能拉列表'
              : preset.provider === 'codex'
                ? 'Codex 后端不支持列表查询(模型写死)'
                : ml.loading
                  ? '正在拉取…'
                  : '从 OAuth API 重新拉一次 model 列表'
          }
        >
          {ml.loading ? '⟳' : '↻'}
        </button>
      </div>
      {mode === 'custom' && (
        <input
          value={customInput}
          onChange={(e) => {
            setCustomInput(e.target.value);
            if (e.target.value.trim()) onModelChange(e.target.value.trim());
          }}
          placeholder="例如 gpt-5-codex / o1-pro / 任何 model 名"
          autoFocus
          style={{ ...inputStyle }}
        />
      )}
      {ml.error && logged && (
        <div style={{ fontSize: 11, color: 'var(--error)' }}>
          拉取失败:{ml.error.slice(0, 160)}
        </div>
      )}
      {ml.apiModels.length > 0 && ml.fetchedAt && (
        <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
          {ml.apiModels.length} 个 API model · {formatAgo(ml.fetchedAt)}前拉取
        </div>
      )}
    </div>
  );
}

// ============================================================
// ImageProviderPanel — image gen 独立 provider 配置(generate_image 工具用)
// ============================================================

function ImageProviderPanel({ onSaved }: { onSaved(): void }) {
  const [presetId, setPresetId] = useState<string>(IMAGE_PROVIDER_PRESETS[0].id);
  const preset = getImagePresetById(presetId) ?? IMAGE_PROVIDER_PRESETS[0];
  const [model, setModel] = useState<string>(preset.models[0] ?? '');
  const [customModel, setCustomModel] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>(preset.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<{ hasKey: boolean; model: string | null; baseUrl: string | null } | null>(null);

  // 启动时:先从 IDB 持久化 image profile 读 → 推到 preset/model/baseUrl
  // 再拉一次 server-side image config 看是否激活
  useEffect(() => {
    (async () => {
      const persisted = await getImageProvider();
      if (persisted) {
        const p = getImagePresetById(persisted.presetId);
        if (p) {
          setPresetId(p.id);
          setModel(persisted.model);
          if (persisted.baseUrl) setBaseUrl(persisted.baseUrl);
        }
      }
      const c = await fetchImageConfig();
      if (c) setCurrentConfig(c);
    })();
  }, []);

  // 切 preset → 重置
  useEffect(() => {
    setBaseUrl(preset.baseUrl ?? '');
    if (preset.models.length > 0) {
      setModel(preset.models[0]);
      setCustomModel('');
    } else {
      setModel('');
    }
  }, [presetId]);

  // 查 keychain
  useEffect(() => {
    const n = native();
    if (!n) return;
    n.keychain.get(`image:${presetId}`).then((v) => setHasStoredKey(!!v));
  }, [presetId, msg]);

  const finalModel = customModel.trim() || model;
  const canEditBaseUrl = preset.category === 'custom';

  async function save() {
    setError(null);
    setMsg(null);
    const n = native();
    if (!n) return;
    if (!finalModel) {
      setError('请填 model');
      return;
    }
    setSaving(true);
    try {
      if (apiKey.trim()) {
        await n.keychain.set(`image:${presetId}`, apiKey.trim());
        setHasStoredKey(true);
      } else if (!hasStoredKey) {
        setError('请输入 API key(还没存过)');
        setSaving(false);
        return;
      }
      const finalBaseUrl = baseUrl.trim() || preset.baseUrl;
      await n.imageProvider.update({
        account: `image:${presetId}`,
        model: finalModel,
        baseUrl: finalBaseUrl,
      });
      // 持久化到 IDB,重启自动 sync
      await saveImageProvider({
        presetId,
        model: finalModel,
        baseUrl: finalBaseUrl ?? null,
      });
      setMsg('✓ Image provider 已保存并激活');
      setApiKey('');
      onSaved();
      // 拉一次最新 config 状态
      fetchImageConfig().then(setCurrentConfig);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm('清除当前 image provider?生成功能将不可用直到重新配置。')) return;
    const n = native();
    if (!n) return;
    await n.imageProvider.update(null);
    await clearImageProvider();
    setMsg('✓ 已清除');
    fetchImageConfig().then(setCurrentConfig);
    onSaved();
  }

  const grouped = {
    official: IMAGE_PROVIDER_PRESETS.filter((p) => p.category === 'official'),
    gateway: IMAGE_PROVIDER_PRESETS.filter((p) => p.category === 'gateway'),
    custom: IMAGE_PROVIDER_PRESETS.filter((p) => p.category === 'custom'),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 4 }}>
        给 AI 配生图能力(<Mono>generate_image</Mono> 工具)。默认 AI 不会自动生图,你说"生一张 hero 图"它才调。生图 5-30s,费用 $0.04-0.17/张。
      </div>

      {currentConfig?.hasKey && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--surface-1)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success, #4ade80)' }} />
          <span>当前活动:<Mono>{currentConfig.model}</Mono> {currentConfig.baseUrl && <span style={{ color: 'var(--text-disabled)' }}>· {currentConfig.baseUrl}</span>}</span>
          <div style={{ flex: 1 }} />
          <button onClick={clear} style={{ ...btnSecondary, padding: '2px 8px', fontSize: 11 }}>清除</button>
        </div>
      )}

      <Field label="Provider preset">
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          style={selectStyle}
        >
          <optgroup label="── Official ──">
            {grouped.official.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
          <optgroup label="── Gateways ──">
            {grouped.gateway.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
          <optgroup label="── Custom ──">
            {grouped.custom.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
        </select>
        {preset.notes && <div style={hintStyle}>{preset.notes}</div>}
      </Field>

      <Field label="Model">
        <select
          value={preset.models.includes(model) ? model : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setModel('');
            } else {
              setModel(e.target.value);
              setCustomModel('');
            }
          }}
          style={selectStyle}
        >
          {preset.models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {(!preset.models.includes(model) || customModel) && (
          <input
            value={customModel || model}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="自定义 image model 名"
            style={{ ...inputStyle, marginTop: 6 }}
          />
        )}
      </Field>

      <Field label="Base URL">
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={preset.baseUrl ?? '留空 = OpenAI 默认 https://api.openai.com/v1'}
          style={inputStyle}
          disabled={!canEditBaseUrl}
        />
        {!canEditBaseUrl && <div style={hintStyle}>preset 锁定,切到 Custom 才能改</div>}
      </Field>

      <Field label={`API Key (Keychain: image:${presetId})`}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasStoredKey ? '已存(留空保留当前)' : '粘贴 key'}
          style={inputStyle}
        />
        <div style={hintStyle}>
          {hasStoredKey ? '✓ 已存,本地 secrets.dat 加密' : '✕ 还没存过 — 请输入'}
        </div>
      </Field>

      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      {msg && <div style={{ color: 'var(--success, #4ade80)', fontSize: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? '保存中…' : '保存并激活'}
        </button>
      </div>

      <div style={footnoteStyle}>
        Image provider 跟 LLM provider 独立(Anthropic / Gemini 用户也能配 OpenAI 生图)。
        费用提示:<Mono>gpt-image-1</Mono> standard $0.04/张,high $0.17/张;阿里万相约 ¥0.14/张。AI 默认不主动生图,用户明确说才调。
      </div>
    </div>
  );
}

// ============================================================
// ProfilesManager — Sprint H profile 列表 + 切换
// ============================================================

function ProfilesManager({ onActivated }: { onActivated(): void }) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [list, active] = await Promise.all([listProfiles(), getActiveProfileId()]);
    setProfiles(list);
    setActiveId(active);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function activate(p: ModelProfile) {
    const n = native();
    if (!n) return;
    // 检查 keychain 有没 key
    const k = await n.keychain.get(p.presetId);
    if (!k) {
      alert(`这个 profile 的 API key 还没存(account: ${p.presetId})。先去 "当前配置" tab 填一下。`);
      return;
    }
    await n.provider.update({
      provider: p.provider,
      account: p.presetId,
      model: p.model,
      baseUrl: p.baseUrl || undefined,
    });
    await setActiveProfile(p.presetId);
    setActiveId(p.presetId);
    onActivated();
  }

  async function remove(p: ModelProfile) {
    if (!confirm(`删除 profile "${p.name}"?(不会删 keychain 里的 key)`)) return;
    await deleteProfile(p.presetId);
    refresh();
  }

  if (loading) return <div style={{ color: 'var(--text-tertiary)' }}>loading…</div>;

  return (
    <div>
      <div style={{ ...hintStyle, marginBottom: 12 }}>
        Profile 是 (preset, model, baseUrl) 组合的命名快捷方式。同 preset 不同 model 也算两个 profile(只是 key 是共享的)。
      </div>

      {profiles.length === 0 && (
        <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13, fontStyle: 'italic' }}>
          还没 profile。去 "当前配置" tab 保存一次就会创建第一个。
        </div>
      )}

      {profiles.map((p) => {
        const isActive = p.presetId === activeId;
        return (
          <div
            key={p.presetId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              marginBottom: 6,
              borderRadius: 6,
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-subtle)'}`,
              background: isActive ? 'rgba(255,164,81,0.06)' : 'var(--bg-elevated)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                {isActive && <span style={{ color: 'var(--accent)', marginRight: 6 }}>●</span>}
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {p.provider} · {p.model}
                {p.baseUrl && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--text-disabled)' }}>{p.baseUrl}</span>
                  </>
                )}
              </div>
            </div>
            {isActive ? (
              <span className="wb-pill accent" style={{ fontSize: 10 }}>active</span>
            ) : (
              <button onClick={() => activate(p)} style={btnSmall}>切换</button>
            )}
            <button onClick={() => remove(p)} style={btnSmallGhost} title="删除">✕</button>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// BrowserReadonly — 浏览器模式只读
// ============================================================

function BrowserReadonly({ cfg }: { cfg: ServerConfigInfo }) {
  return (
    <>
      <Field label="Provider"><Mono>{cfg.provider}</Mono></Field>
      <Field label="Model"><Mono>{cfg.model}</Mono></Field>
      <Field label="Base URL"><Mono>{cfg.baseUrl ?? '(SDK 默认)'}</Mono></Field>
      <Field label="API Key">
        <span style={{ color: cfg.hasKey ? 'var(--success)' : 'var(--error)' }}>
          {cfg.hasKey ? '✓ 已配置(在后端 .env)' : '✕ 未配置'}
        </span>
      </Field>
      <div style={footnoteStyle}>
        浏览器模式 = 只读。改配置编辑项目根 .env,然后重启 pnpm dev。
        Electron 套壳下可在此界面改并存到 OS 钥匙串。
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <label style={{
        fontSize: 10, color: 'var(--text-tertiary)',
        letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
      {children}
    </span>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-5)',
};

const panel: React.CSSProperties = {
  width: 580,
  maxWidth: '100%',
  maxHeight: '85vh',
  overflowY: 'auto',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: 'var(--shadow-lg)',
};

const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  borderBottom: '1px solid var(--border-subtle)',
  marginBottom: 16,
};

const tabBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--text-tertiary)',
  background: 'transparent',
  border: 0,
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
};
const tabBtnActive: React.CSSProperties = {
  color: 'var(--text-primary)',
  borderBottomColor: 'var(--accent)',
};

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

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  marginTop: 4,
};

const refreshBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 3,
  fontSize: 14,
  cursor: 'pointer',
  flex: '0 0 auto',
  height: 28,
  width: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function formatAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const footnoteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  lineHeight: 1.6,
  paddingTop: 12,
  marginTop: 8,
  borderTop: '1px solid var(--border-subtle)',
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

const btnSmall: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  fontSize: 11,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
};

const btnSmallGhost: React.CSSProperties = {
  padding: '4px 6px',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: 0,
  fontSize: 12,
  cursor: 'pointer',
};
