/* 工具调用展示 — 默认折叠,显示 "→ write_file index.html (2.3kb)"
 * 点开展开看完整 input + result
 *
 * generate_image 特殊处理:result 含图路径时显示缩略 + 估价
 */

import { useEffect, useState } from 'react';
import { previewUrl } from '../preview/injectBuilder';
import { getRootPath } from '../store/files';

export interface ToolCallBlockProps {
  name: string;
  input: any;
  result?: { content: string; is_error?: boolean };
  /** 流式中(args 还在累积),显示小圈 */
  streaming?: boolean;
  projectId?: number;
}

export function ToolCallBlock({ name, input, result, streaming, projectId }: ToolCallBlockProps) {
  const [open, setOpen] = useState(name === 'generate_image' && !!result); // 生图默认展开看图
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
          {result && name === 'generate_image' && !errored && (
            <Section label="generated">
              <ImagePreview projectId={projectId} content={result.content} />
            </Section>
          )}
          {result && (name !== 'generate_image' || errored) && (
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
  if (name === 'generate_image') {
    const f = String(input.filename ?? '?.png');
    const sz = String(input.size ?? '1024x1024');
    const q = String(input.quality ?? 'standard');
    return `uploads/${f} · ${sz} · ${q}`;
  }
  return Object.keys(input).join(', ');
}

// generate_image 的图片预览 — content 里有 "uploads/xxx.png" 字符串,解出来用 previewUrl 加载
function ImagePreview({ projectId, content }: { projectId?: number; content: string }) {
  const [rootPath, setRootPath] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!projectId) return;
    getRootPath(projectId).then(setRootPath).catch(() => setRootPath(null));
  }, [projectId]);

  const m = content.match(/uploads\/[^\s]+/);
  if (!m || !projectId || rootPath === undefined) {
    return <pre style={preStyle}>{content}</pre>;
  }
  const imgPath = m[0];
  const url = previewUrl(projectId, imgPath, Date.now(), rootPath);
  // 解析估价(content 含 "estimated cost: $0.040")
  const costMatch = content.match(/estimated cost:\s*\$([\d.]+)/);
  const cost = costMatch ? `$${parseFloat(costMatch[1]).toFixed(3)}` : null;
  const revisedMatch = content.match(/revised prompt:\s*(.+?)(?:\)|$)/);
  const revised = revisedMatch ? revisedMatch[1].trim() : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <img
        src={url}
        alt={imgPath}
        style={{
          maxWidth: '100%',
          maxHeight: 280,
          borderRadius: 4,
          border: '1px solid var(--border-subtle)',
          display: 'block',
        }}
      />
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-tertiary)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{imgPath}</span>
        {cost && (
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            ~{cost}
          </span>
        )}
      </div>
      {revised && (
        <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic', lineHeight: 1.4 }}>
          provider revised → {revised}
        </div>
      )}
    </div>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}
