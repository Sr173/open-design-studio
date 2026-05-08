/* TweaksPanel — 当前项目所有 marker 聚合渲染
 *
 * writing 蒙层期间全 disabled,避免并发改写
 * 用户改值 → markerWriter 回写 → 入 userActionBuffer
 */

import { useEffect, useState } from 'react';
import type { TweakMarker } from '../tweaks/markerParser';
import { listAllMarkers, writeTweakValue } from '../tweaks/markerWriter';
import { TweakControl } from '../tweaks/controls';
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
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await listAllMarkers(projectId);
      if (!cancelled) setMarkers(list);
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

  if (markers.length === 0) return null;

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
        <span style={{ marginLeft: 12 }}>({markers.length})</span>
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
        </div>
      )}
    </div>
  );
}
