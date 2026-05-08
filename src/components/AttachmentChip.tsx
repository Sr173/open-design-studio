/* vision 附件 chip — 显示在输入框上方 */

import type { VisionImage } from '../attachments/vision';

export function AttachmentChip({
  img,
  onRemove,
}: {
  img: VisionImage;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px 4px 4px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-secondary)',
      }}
    >
      <img
        src={`data:${img.mediaType};base64,${img.data}`}
        alt=""
        style={{
          width: 22,
          height: 22,
          objectFit: 'cover',
          borderRadius: 3,
          flex: '0 0 auto',
        }}
      />
      <span style={{ fontFamily: 'var(--font-mono)' }}>👁</span>
      <span>{img.filename ?? 'image'}</span>
      <span style={{ color: 'var(--text-tertiary)' }}>
        {Math.round(img.bytes / 1024)}kb
      </span>
      <button
        onClick={onRemove}
        style={{
          color: 'var(--text-tertiary)',
          marginLeft: 2,
        }}
      >
        ✕
      </button>
    </div>
  );
}
