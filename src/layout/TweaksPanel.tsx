/* TweaksPanel — 当前项目所有 marker 聚合渲染
 *
 * writing 蒙层期间全 disabled,避免并发改写
 * 用户改值 → markerWriter 回写 → 入 userActionBuffer
 */

import { useEffect, useState } from 'react';
import type { TweakMarker } from '../tweaks/markerParser';
import { listAllMarkers, writeTweakValue } from '../tweaks/markerWriter';
import { TweakControl } from '../tweaks/controls';
import {
  listAllEditmodeFields,
  writeEditmodeValue,
  type EditmodeField,
} from '../tweaks/editmodeBlock';
import { onFileChange } from '../store/files';
import { pushAction } from '../store/userActionBuffer';

export function TweaksPanel({
  projectId,
  disabled,
}: {
  projectId: number;
  disabled?: boolean;
}) {
  const [markers, setMarkers] = useState<TweakMarker[]>([]);
  const [editmode, setEditmode] = useState<EditmodeField[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [list, fields] = await Promise.all([
        listAllMarkers(projectId),
        listAllEditmodeFields(projectId),
      ]);
      if (!cancelled) {
        setMarkers(list);
        setEditmode(fields);
      }
    };
    refresh();
    const unsub = onFileChange((e) => {
      if (e.projectId === projectId) refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [projectId]);

  const totalCount = markers.length + editmode.length;
  if (totalCount === 0) return null;

  async function handleEditmodeChange(field: EditmodeField, next: string | number | boolean) {
    if (disabled) return;
    if (field.value === next) return;
    const r = await writeEditmodeValue(
      projectId,
      field.filePath,
      field.blockIndex,
      field.key,
      next,
      'user',
    );
    if (r.found) {
      pushAction({
        kind: 'tweak_change',
        tweakId: `editmode:${field.key}`,
        tweakType: field.type,
        before: String(field.value),
        after: String(next),
      });
    }
  }

  async function handleChange(m: TweakMarker, next: string) {
    if (disabled) return;
    const before = m.currentValue;
    if (before === next) return;
    const r = await writeTweakValue(projectId, m.attrs.id, next, 'user');
    if (r.found) {
      pushAction({
        kind: 'tweak_change',
        tweakId: m.attrs.id,
        tweakType: m.attrs.type,
        before,
        after: next,
      });
    }
  }

  return (
    <div
      style={{
        flex: '0 0 auto',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border-subtle)',
        maxHeight: open ? 240 : 28,
        transition: 'max-height 120ms ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          height: 28,
          padding: '0 var(--sp-3)',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          userSelect: 'none',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span style={{ marginLeft: 8 }}>tweaks</span>
        <span style={{ marginLeft: 12 }}>
          ({markers.length}{editmode.length > 0 ? ` + ${editmode.length} editmode` : ''})
        </span>
      </div>
      {open && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--sp-2) var(--sp-3)',
          }}
        >
          {markers.map((m) => (
            <div
              key={`${m.filePath}#${m.attrs.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 8,
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${m.attrs.id} (${m.fileLang}) — ${m.filePath}`}
              >
                {m.attrs.label || m.attrs.id}
              </div>
              <TweakControl
                marker={m}
                disabled={disabled}
                onChange={(v) => handleChange(m, v)}
              />
            </div>
          ))}
          {editmode.map((f) => (
            <div
              key={`em:${f.filePath}:${f.blockIndex}:${f.key}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 8,
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`editmode ${f.key} — ${f.filePath} (block #${f.blockIndex})`}
              >
                ◆ {f.label}
              </div>
              <EditmodeControl
                field={f}
                disabled={disabled}
                onChange={(v) => handleEditmodeChange(f, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 内嵌 control — 根据 EditmodeField.type 推断渲染 */
function EditmodeControl({
  field,
  disabled,
  onChange,
}: {
  field: EditmodeField;
  disabled?: boolean;
  onChange(v: string | number | boolean): void;
}) {
  const baseInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 3,
    padding: '3px 6px',
    fontSize: 'var(--fs-xs)',
    fontFamily: 'var(--font-mono)',
  };

  if (field.type === 'toggle') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)' }}>
        <input
          type="checkbox"
          checked={!!field.value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ color: 'var(--text-tertiary)' }}>
          {String(field.value)}
        </span>
      </label>
    );
  }

  if (field.type === 'color') {
    const v = String(field.value);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'transparent' }}
        />
        <input
          type="text"
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={baseInputStyle}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    const min = field.meta?.min;
    const max = field.meta?.max;
    const step = field.meta?.step ?? 1;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {min != null && max != null && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(field.value)}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        )}
        <input
          type="number"
          value={Number(field.value)}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...baseInputStyle, flex: '0 0 70px' }}
        />
      </div>
    );
  }

  if (field.type === 'select' && field.meta?.options) {
    return (
      <select
        value={String(field.value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={baseInputStyle}
      >
        {field.meta.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  // text fallback
  return (
    <input
      type="text"
      value={String(field.value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={baseInputStyle}
    />
  );
}
