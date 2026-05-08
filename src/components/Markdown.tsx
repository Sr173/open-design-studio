/* 极简 markdown 渲染 — 仅 fenced code blocks + inline code + 段落
 * 不引入第三方库,保持 bundle 小;复杂渲染可 v2+ 加 react-markdown
 */

import { Fragment } from 'react';

export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  const segments = parseSegments(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'code') {
          return (
            <pre
              key={i}
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2) var(--sp-3)',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
                whiteSpace: 'pre',
                overflow: 'auto',
                margin: '6px 0',
              }}
            >
              {seg.lang && (
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--text-tertiary)',
                    marginBottom: 4,
                  }}
                >
                  {seg.lang}
                </div>
              )}
              <code>{seg.text}</code>
            </pre>
          );
        }
        return (
          <p
            key={i}
            style={{
              margin: '4px 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {renderInline(seg.text)}
          </p>
        );
      })}
    </>
  );
}

interface Segment {
  kind: 'text' | 'code';
  text: string;
  lang?: string;
}

function parseSegments(input: string): Segment[] {
  const out: Segment[] = [];
  const fenceRe = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(input))) {
    if (m.index > last) {
      out.push({ kind: 'text', text: input.slice(last, m.index) });
    }
    out.push({ kind: 'code', lang: m[1].trim() || undefined, text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ kind: 'text', text: input.slice(last) });
  if (out.length === 0) out.push({ kind: 'text', text: input });
  return out;
}

function renderInline(text: string) {
  // inline code only(其他 md 后续加)
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`') && p.length > 1) {
      return (
        <code
          key={i}
          style={{
            background: 'var(--bg-input)',
            padding: '1px 5px',
            borderRadius: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9em',
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
