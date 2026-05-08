/* Tweak 控件:color / text / number / select / toggle */

import type { TweakMarker } from './markerParser';

interface ControlProps {
  marker: TweakMarker;
  disabled?: boolean;
  onChange: (next: string) => void;
}

export function TweakControl({ marker, disabled, onChange }: ControlProps) {
  const t = marker.attrs.type;
  if (t === 'color') return <ColorControl {...{ marker, disabled, onChange }} />;
  if (t === 'number') return <NumberControl {...{ marker, disabled, onChange }} />;
  if (t === 'toggle') return <ToggleControl {...{ marker, disabled, onChange }} />;
  if (t === 'select') return <SelectControl {...{ marker, disabled, onChange }} />;
  return <TextControl {...{ marker, disabled, onChange }} />;
}

function ColorControl({ marker, disabled, onChange }: ControlProps) {
  const cur = normalizeHex(marker.currentValue);
  return (
    <div style={controlRow}>
      <input
        type="color"
        value={cur}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: 'none', background: 'transparent' }}
      />
      <input
        type="text"
        value={marker.currentValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1, fontFamily: 'var(--font-mono)' }}
      />
    </div>
  );
}

function TextControl({ marker, disabled, onChange }: ControlProps) {
  return (
    <input
      type="text"
      value={marker.currentValue}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: '100%' }}
    />
  );
}

function NumberControl({ marker, disabled, onChange }: ControlProps) {
  const a = marker.attrs;
  const min = a.min;
  const max = a.max;
  const step = a.step ?? 1;
  return (
    <div style={controlRow}>
      {min != null && max != null && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={marker.currentValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1 }}
        />
      )}
      <input
        type="number"
        value={marker.currentValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        style={{ ...inputStyle, width: 80, fontFamily: 'var(--font-mono)' }}
      />
    </div>
  );
}

function ToggleControl({ marker, disabled, onChange }: ControlProps) {
  const isOn = marker.currentValue === 'true';
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={isOn}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
      />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }}>
        {isOn ? 'true' : 'false'}
      </span>
    </label>
  );
}

function SelectControl({ marker, disabled, onChange }: ControlProps) {
  const opts = marker.attrs.options ?? [];
  if (opts.length === 0) return <TextControl {...{ marker, disabled, onChange }} />;
  return (
    <select
      value={marker.currentValue}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function normalizeHex(v: string): string {
  // <input type=color> 要求 #rrggbb 格式
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const c = v.slice(1);
    return '#' + c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7);  // 截掉 alpha
  return '#888888';
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 6px',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-primary)',
};

const controlRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};
