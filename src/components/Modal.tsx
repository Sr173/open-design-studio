/* 通用 modal 容器 — 给 ProjectBriefDialog / NewTaskDialog 用 */

import type { ReactNode } from 'react';

export function Modal({
  open,
  onClose,
  title,
  width = 560,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
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
          width,
          maxWidth: '100%',
          maxHeight: '90vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          style={{
            padding: 'var(--sp-4) var(--sp-5)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{title}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            ✕
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--sp-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-4)',
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: 'var(--sp-3) var(--sp-5)',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 'var(--sp-2)',
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
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
        {required && <span style={{ color: 'var(--accent)' }}> *</span>}
      </label>
      {hint && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

export function ChipMulti({
  options,
  values,
  onChange,
  allowOther,
}: {
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
  allowOther?: boolean;
}) {
  const presets = new Set(options);
  const otherValue = values.find((v) => !presets.has(v)) ?? '';

  function toggle(v: string) {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {options.map((o) => {
        const sel = values.includes(o);
        return (
          <button
            key={o}
            onClick={() => toggle(o)}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 'var(--fs-xs)',
              border: sel ? '1px solid var(--accent)' : '1px solid var(--border-default)',
              background: sel ? 'rgba(255,164,81,0.12)' : 'transparent',
              color: sel ? 'var(--accent)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {o}
          </button>
        );
      })}
      {allowOther && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => {
            const filtered = values.filter((v) => presets.has(v));
            const v = e.target.value.trim();
            onChange(v ? [...filtered, v] : filtered);
          }}
          placeholder="Other..."
          style={{
            padding: '5px 12px',
            borderRadius: 999,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-primary)',
            minWidth: 140,
            fontFamily: 'inherit',
          }}
        />
      )}
    </div>
  );
}

export function ChipSingle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value?: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const sel = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 'var(--fs-xs)',
              border: sel ? '1px solid var(--accent)' : '1px solid var(--border-default)',
              background: sel ? 'rgba(255,164,81,0.12)' : 'transparent',
              color: sel ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 10px',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  width: '100%',
};

export const btnPrimary: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent)',
  color: '#1a1410',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
};

export const btnSecondary: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  border: '1px solid var(--border-default)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
};
