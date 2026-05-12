/* 工具调用展示 — 默认折叠,显示 "→ write_file index.html (2.3kb)"
 * 点开展开看完整 input + result
 */

import { useState } from 'react';

export interface ToolCallBlockProps {
  name: string;
  input: any;
  result?: { content: string; is_error?: boolean };
  /** 流式中(args 还在累积),显示小圈 */
  streaming?: boolean;
}

export function ToolCallBlock({ name, input, result, streaming }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const summary = makeSummary(name, input);
  const errored = result?.is_error;

  return (
    <div
      style={{
        margin: '4px 0',
        border: `1px solid ${errored ? 'var(--error)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-input)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px',
          cursor: 'pointer',
          color: errored ? 'var(--error)' : 'var(--text-secondary)',
          gap: 6,
        }}
      >
        <span style={{ color: 'var(--text-tertiary)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--accent)' }}>→</span>
        <span style={{ color: 'var(--text-primary)' }}>{name}</span>
        <span style={{ flex: 1, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary || (streaming ? '正在拼参数…' : '')}
        </span>
        {streaming && !result && (
          <>
            <style>{`@keyframes aidTbcSpin { to { transform: rotate(360deg); } }`}</style>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                border: '1.5px solid var(--border-default)',
                borderTopColor: 'var(--accent)',
                animation: 'aidTbcSpin 0.7s linear infinite',
                display: 'inline-block',
              }}
            />
          </>
        )}
        {result && !errored && (
          <span style={{ color: 'var(--success)' }}>✓</span>
        )}
        {errored && <span>✕</span>}
      </div>
      {open && (
        <div
          style={{
            padding: '6px 10px',
            borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <Section label="input">
            <pre style={preStyle}>
              {JSON.stringify(input, null, 2)}
            </pre>
          </Section>
          {result && (
            <Section label="result">
              <pre
                style={{
                  ...preStyle,
                  color: errored ? 'var(--error)' : 'var(--text-secondary)',
                }}
              >
                {result.content}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
  maxHeight: 200,
  overflow: 'auto',
};

function makeSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  if (name === 'write_file') {
    const p = String(input.path ?? '');
    const c = String(input.content ?? '');
    return `${p} (${humanBytes(c.length)})`;
  }
  if (name === 'read_file') return String(input.path ?? '');
  if (name === 'delete_file')
    return Array.isArray(input.paths) ? input.paths.join(', ') : '';
  if (name === 'show_to_user') return String(input.path ?? '');
  if (name === 'done') return String(input.summary ?? '');
  if (name === 'list_files') return '';
  return Object.keys(input).join(', ');
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}
