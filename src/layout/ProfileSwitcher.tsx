/* ProfileSwitcher — TopBar 里的模型快切 pill (Sprint H)
 *
 *   [● Anthropic · sonnet-4-5 ▼]
 *
 * 点击展开 dropdown:
 *   ┌────────────────────────────┐
 *   │ ● Anthropic · sonnet-4-5  │  ← active
 *   │   Gemini · 2.0-flash      │
 *   │   DeepSeek · v3           │
 *   ├────────────────────────────┤
 *   │ ⚙ 管理 profiles...         │
 *   └────────────────────────────┘
 *
 * 切换 profile 时:① 拉 keychain 取 key ② IPC 把 server provider 切过去 ③ 写 active
 * 走的是 profileSync 同样的路径,但前端直接调,不重启 app
 */

import { useEffect, useRef, useState } from 'react';
import { native, isElectron } from '../native';
import { listProfiles, getActiveProfileId, setActiveProfile, type ModelProfile } from '../store/profiles';

interface ProfileSwitcherProps {
  onOpenSettings(): void;
}

export function ProfileSwitcher({ onOpenSettings }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [ps, a] = await Promise.all([listProfiles(), getActiveProfileId()]);
    setProfiles(ps);
    setActiveId(a);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000); // 让别处改动 (settings page) 反映回来
    return () => clearInterval(t);
  }, []);

  // 关 dropdown — 点外面 + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = profiles.find((p) => p.presetId === activeId) ?? null;

  async function activate(p: ModelProfile) {
    if (!isElectron()) return;
    const n = native();
    if (!n) return;
    setSwitching(true);
    try {
      const key = await n.keychain.get(p.presetId);
      if (!key) {
        alert(`profile "${p.name}" 没存 API key — 去 ⚙ 设置面板填一下`);
        setSwitching(false);
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
      setOpen(false);
    } catch (e: any) {
      alert(`切换失败:${e?.message ?? e}`);
    } finally {
      setSwitching(false);
    }
  }

  // 浏览器模式 / 没有 profile 时显示 fallback
  if (!isElectron() || profiles.length === 0) {
    return (
      <button
        onClick={onOpenSettings}
        style={{
          ...pillBtn,
          WebkitAppRegion: 'no-drag',
          color: 'var(--text-tertiary)',
        } as React.CSSProperties}
        title="还没配置模型 — 点击去设置"
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--text-disabled)',
        }} />
        <span>未配置</span>
      </button>
    );
  }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        style={pillBtn}
        title={active ? `${active.provider} · ${active.model}\n点击切换` : '选择 profile'}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: switching ? 'var(--accent)' : (active ? 'var(--success)' : 'var(--text-disabled)'),
          flex: '0 0 6px',
        }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
          {active ? active.name : '选择 profile'}
        </span>
        <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>▼</span>
      </button>

      {open && (
        <div style={dropdown}>
          {profiles.map((p) => (
            <button
              key={p.presetId}
              onClick={() => activate(p)}
              disabled={switching}
              style={{
                ...itemBtn,
                background: p.presetId === activeId ? 'var(--surface-2)' : 'transparent',
              }}
              title={`${p.provider} · ${p.model}${p.baseUrl ? `\n${p.baseUrl}` : ''}`}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: p.presetId === activeId ? 'var(--success)' : 'var(--text-disabled)',
                flex: '0 0 6px',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span style={{
                  color: 'var(--text-primary)',
                  fontWeight: p.presetId === activeId ? 600 : 400,
                  fontSize: 'var(--fs-xs)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                }}>{p.name}</span>
                <span style={{
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                }}>{p.provider} · {p.model}</span>
              </div>
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
          <button
            onClick={() => { setOpen(false); onOpenSettings(); }}
            style={itemBtn}
          >
            <span style={{ width: 6, flex: '0 0 6px' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-xs)' }}>
              ⚙ 管理 profiles...
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 'var(--fs-xs)',
  height: 22,
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

const dropdown: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  minWidth: 220,
  maxHeight: 320,
  overflowY: 'auto',
  background: 'var(--bg-elev)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 6px 24px rgba(0,0,0,0.32)',
  padding: 4,
  zIndex: 1000,
};

const itemBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  border: 0,
  borderRadius: 'var(--radius-sm)',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
};
