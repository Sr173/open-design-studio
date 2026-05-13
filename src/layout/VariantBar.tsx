/* VariantBar — 画布底部 48px 横条
 *
 *  [variants] [A · sidebar-companion] [B · canvas-first-dock · current] [C · spatial-overlay]
 *                                                       ↶ 回滚 turn · 上一条 12s 前
 *
 *  类似 sidebar-companion 原型的 variant-bar
 */

import { useEffect, useState } from 'react';
import type { ChatController } from '../store/chat';
import { detectVariants, type VariantInfo } from '../preview/variants';
import { listFiles } from '../store/files';
import {
  readReviewState,
  setReviewStatus,
  type ReviewStatus,
} from '../store/reviewState';

export interface VariantBarProps {
  controller: ChatController;
  activeSlug: string | null;
  onSelect(slug: string): void;
}

export function VariantBar({ controller, activeSlug, onSelect }: VariantBarProps) {
  const [variants, setVariants] = useState<VariantInfo[]>([]);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [mtimes, setMtimes] = useState<Map<string, number>>(new Map());
  const [review, setReview] = useState<Record<string, ReviewStatus>>({});

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const [files, rs] = await Promise.all([
        listFiles(controller.projectId).catch(() => []),
        readReviewState(controller.projectId).catch(() => ({ variants: {} } as any)),
      ]);
      if (!alive) return;
      setVariants(detectVariants(files));
      setReview(rs.variants ?? {});
      const s = new Map<string, number>();
      const m = new Map<string, number>();
      for (const f of files) {
        s.set(f.path, f.content?.length ?? 0);
        m.set(f.path, f.mtime);
      }
      setSizes(s);
      setMtimes(m);
    }
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [controller.projectId]);

  async function cycleStatus(slug: string) {
    // null → approved → needs-changes → rejected → null
    const cur = review[slug];
    const next: ReviewStatus | null =
      cur === undefined ? 'approved'
        : cur === 'approved' ? 'needs-changes'
          : cur === 'needs-changes' ? 'rejected'
            : null;
    await setReviewStatus(controller.projectId, slug, next);
    setReview((r) => {
      const cp = { ...r };
      if (next === null) delete cp[slug]; else cp[slug] = next;
      return cp;
    });
  }

  if (variants.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        flex: '0 0 48px',
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 18px',
        background: 'var(--bg-base)',
        borderTop: '1px solid var(--border-subtle)',
        overflow: 'auto',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginRight: 6,
          flexShrink: 0,
        }}
      >
        variants · {variants.length}
      </span>

      {variants.map((v, i) => {
        const isActive = v.slug === activeSlug;
        const letter = String.fromCharCode(65 + i);
        const risk = i === 0 ? '保守' : i === variants.length - 1 ? '大胆' : '中位';
        const size = sizes.get(v.path) ?? 0;
        const mtime = mtimes.get(v.path) ?? 0;
        const status = review[v.slug];
        const statusSym =
          status === 'approved' ? '🟢'
            : status === 'needs-changes' ? '🟡'
              : status === 'rejected' ? '🔴'
                : '';
        const statusTitle =
          status === 'approved' ? '已选(approved)— 后续编辑默认 scope 到这个变体'
            : status === 'needs-changes' ? '需要改(needs-changes)— agent 会知道这个状态'
              : status === 'rejected' ? '弃用(rejected)'
                : '点 ⚪ 按钮循环切换:🟢 选这个 → 🟡 改改 → 🔴 弃 → 清空';
        return (
          <div
            key={v.slug}
            style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
          >
          <button
            onClick={(e) => { e.stopPropagation(); cycleStatus(v.slug); }}
            title={statusTitle}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              border: '1px solid var(--border-subtle)',
              background: status ? 'transparent' : 'var(--bg-panel)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {statusSym || <span style={{ color: 'var(--text-disabled)', fontSize: 11 }}>⚪</span>}
          </button>
          <button
            onClick={() => onSelect(v.slug)}
            title={[
              v.dna && `DNA: ${v.dna}`,
              v.fits && `Fits: ${v.fits}`,
              v.tradeoff && `Tradeoff: ${v.tradeoff}`,
            ]
              .filter(Boolean)
              .join('\n')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px 6px 6px',
              borderRadius: 'var(--radius-sm)',
              background: isActive ? 'rgba(255,164,81,0.10)' : 'var(--bg-panel)',
              border: `1px solid ${isActive ? 'rgba(255,164,81,0.32)' : 'var(--border-subtle)'}`,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              flexShrink: 0,
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 32,
                height: 20,
                borderRadius: 3,
                background: `linear-gradient(135deg, ${
                  i === 0 ? '#fff1e3' : i === 1 ? '#ffe9d4' : '#ffdcbf'
                }, #ffd9b3)`,
                flexShrink: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.2 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  color: isActive ? 'var(--accent)' : 'var(--text-disabled)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  fontWeight: 700,
                }}
              >
                {letter} · {risk}{isActive ? ' · current' : ''}
              </span>
              <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)', fontSize: 12, fontWeight: 500 }}>
                {v.displayName ?? v.slug}
              </span>
              <span style={{ display: 'flex', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                <span>{(size / 1024).toFixed(1)}kb</span>
                <span style={{ color: 'var(--text-disabled)' }}>{relTime(mtime)}</span>
              </span>
            </div>
          </button>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}
      >
        ↶ 回滚 turn
      </span>
    </div>
  );
}

function relTime(ts: number): string {
  if (!ts) return '—';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.round(diff)}s 前`;
  if (diff < 3600) return `${Math.round(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h 前`;
  return `${Math.round(diff / 86400)}d 前`;
}
