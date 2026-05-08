/* 模式切换 — preview / inspect / comment / edit
 *
 * writing 蒙层期间整体灰掉(disabled)
 */

import type { PreviewMode } from '../preview/elementBridge';

interface ModeToggleProps {
  mode: PreviewMode;
  onChange: (m: PreviewMode) => void;
  disabled?: boolean;
}

const MODES: {
  id: PreviewMode;
  label: string;
  icon: string;
  hint: string;
}[] = [
  { id: 'preview', label: 'preview', icon: '▣', hint: '只看,不交互' },
  { id: 'inspect', label: 'inspect', icon: '🔍', hint: '点元素查看 / 选中' },
  { id: 'comment', label: 'comment', icon: '💬', hint: '点元素加评论' },
  { id: 'edit', label: 'edit', icon: '✎', hint: '点文字直改(仅纯文本元素)' },
];

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        background: 'var(--bg-elevated)',
        padding: 2,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          title={m.hint}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 3,
            fontSize: 'var(--fs-xs)',
            color: mode === m.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: mode === m.id ? 'var(--bg-base)' : 'transparent',
            fontFamily: 'var(--font-mono)',
            transition: 'background 80ms',
          }}
        >
          <span>{m.icon}</span>
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
