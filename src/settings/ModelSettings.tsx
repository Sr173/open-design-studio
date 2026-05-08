/* 模型管理页 — v1.5:从 后端 拿配置只读展示
 * 改 provider/model/key 都在 .env;前端不再持有 secret
 */

import { useEffect, useState } from 'react';
import { fetchServerConfig, type ServerConfigInfo } from '../llm/clientProvider';

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
          width: 520,
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
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>
            模型设置(后端持有)
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            ✕
          </button>
        </div>

        {loading && <div style={{ color: 'var(--text-tertiary)' }}>loading…</div>}

        {!loading && !cfg && (
          <div style={{ color: 'var(--error)', lineHeight: 1.6 }}>
            ✕ 后端未连通(/api/llm/config 失败)
            <br />
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-xs)' }}>
              确认 dev:server 进程在跑(端口 5174)。
              终端会有 <code>ai-design backend → http://localhost:5174</code> 字样。
            </span>
          </div>
        )}

        {cfg && (
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
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
                lineHeight: 1.6,
                paddingTop: 'var(--sp-3)',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              改配置:编辑项目根目录 <Mono>.env</Mono>(
              <Mono>PROVIDER</Mono>/<Mono>MODEL</Mono>/<Mono>API_KEY</Mono>/
              <Mono>BASE_URL</Mono>),然后重启 <Mono>pnpm dev</Mono>。
              前端永远拿不到 key 和 system prompt。
            </div>
          </>
        )}
      </div>
    </div>
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
