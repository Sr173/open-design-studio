/* VariantTray — 浮动左下,横向变体 + turn timeline mini
 *
 *  样式见 workbench.css 的 .wb-variant-tray / .wb-vt / .wb-turn-mini
 *
 *  数据源:
 *    - variants:从 detectVariants(files) 拿 — 同 PreviewPane
 *    - active variant:父组件传 + onSelect 回写
 *    - mtime:从 file.mtime
 *    - turn timeline:从 db.messages 按 user 分组,算每个 turn 持续时间
 *      短的 → 短条;长的 → 长条;当前进行中的 → accent;abort/error 的 → warn
 */

import { useEffect, useMemo, useState } from 'react';
import type { VariantInfo } from '../preview/variants';
import { detectVariants } from '../preview/variants';
import { listFiles } from '../store/files';
import { db } from '../store/db';
import type { ChatController } from '../store/chat';

export interface VariantTrayProps {
  controller: ChatController;
  activeSlug: string | null;
  onSelect(slug: string): void;
}

export function VariantTray({ controller, activeSlug, onSelect }: VariantTrayProps) {
  const [variants, setVariants] = useState<VariantInfo[]>([]);
  const [filesMtime, setFilesMtime] = useState<Map<string, number>>(new Map());
  const [filesSize, setFilesSize] = useState<Map<string, number>>(new Map());

  // 拉 variants + 文件 mtime/size
  useEffect(() => {
    let alive = true;
    async function refresh() {
      const files = await listFiles(controller.projectId).catch(() => []);
      if (!alive) return;
      const vs = detectVariants(files);
      setVariants(vs);
      const m = new Map<string, number>();
      const s = new Map<string, number>();
      for (const f of files) {
        m.set(f.path, f.mtime);
        s.set(f.path, f.content?.length ?? 0);
      }
      setFilesMtime(m);
      setFilesSize(s);
    }
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [controller.projectId]);

  // 拉 turn timeline:取最近 8 个 user-assistant 对的耗时
  const timeline = useTurnTimeline(controller);

  if (variants.length === 0) return null;

  return (
    <div className="wb-glass wb-variant-tray">
      {variants.map((v, i) => {
        const letter = `${String.fromCharCode(65 + i)} · ${
          i === 0 ? '保守' : i === variants.length - 1 ? '大胆' : '中位'
        }`;
        const size = filesSize.get(v.path) ?? 0;
        const mtime = filesMtime.get(v.path) ?? 0;
        const isActive = v.slug === activeSlug;
        return (
          <button
            key={v.slug}
            className={`wb-vt ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(v.slug)}
            title={[
              v.dna && `DNA: ${v.dna}`,
              v.fits && `Fits: ${v.fits}`,
              v.tradeoff && `Tradeoff: ${v.tradeoff}`,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <span className="thumb" style={{
              background: `linear-gradient(135deg, ${i === 0 ? '#fff5ea' : i === 1 ? '#ffe9d4' : '#ffdcbf'}, #ffd9b3)`,
            }} />
            <div className="meta">
              <div className="letter">{letter}{isActive ? ' · current' : ''}</div>
              <div className="name">{v.displayName ?? v.slug}</div>
              <div className="stats">
                <span>{(size / 1024).toFixed(1)}kb</span>
                <span className="ago">{relTime(mtime)}</span>
              </div>
            </div>
          </button>
        );
      })}

      {/* turn timeline mini */}
      <div className="wb-turn-mini">
        <div>
          <div className="lbl">turns</div>
          <div className="bars" style={{ marginTop: 3 }}>
            {timeline.bars.length === 0 && (
              <b style={{ height: '20%', opacity: 0.4 }} />
            )}
            {timeline.bars.map((b, i) => (
              <b
                key={i}
                style={{ height: `${b.h}%` }}
                className={b.cls}
                title={`turn ${b.idx}: ${b.label}`}
              />
            ))}
          </div>
        </div>
        <div className="nums">
          <div>
            <span className="cur">turn {String(timeline.current).padStart(2, '0')}</span>
          </div>
          <div className="avg">{timeline.avgLabel}</div>
        </div>
      </div>
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

interface TurnBar {
  h: number;
  cls: string;
  idx: number;
  label: string;
}

function useTurnTimeline(controller: ChatController): {
  bars: TurnBar[];
  current: number;
  avgLabel: string;
} {
  const [data, setData] = useState<{ bars: TurnBar[]; current: number; avgLabel: string }>({
    bars: [],
    current: 0,
    avgLabel: '—',
  });

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const msgs = await db.messages
        .where({ chatId: controller.chatId })
        .toArray()
        .catch(() => []);
      if (!alive) return;

      // 用 user msg createdAt 分 turn,assistant 接着的 createdAt 当 turn end
      msgs.sort((a, b) => a.createdAt - b.createdAt);
      const turns: Array<{ startTs: number; endTs: number; interrupted: boolean }> = [];
      let curStart = 0;
      let curInt = false;
      for (const m of msgs) {
        if (m.role === 'user' && m.kind !== 'interrupt_marker') {
          if (curStart > 0) {
            // 上一个 turn 结尾 = 这个 user 之前的最后一条 assistant
            turns.push({ startTs: curStart, endTs: m.createdAt, interrupted: curInt });
            curInt = false;
          }
          curStart = m.createdAt;
        }
        if (m.kind === 'interrupt_marker') curInt = true;
      }
      // 最后一个 turn(还可能在进行中)
      if (curStart > 0) {
        const lastTs = msgs.length > 0 ? msgs[msgs.length - 1].createdAt : Date.now();
        turns.push({ startTs: curStart, endTs: lastTs, interrupted: curInt });
      }

      const slice = turns.slice(-8);
      // 计算时长(秒)
      const durations = slice.map((t) => Math.max(0.1, (t.endTs - t.startTs) / 1000));
      const maxD = Math.max(1, ...durations);
      const bars: TurnBar[] = slice.map((t, i) => ({
        h: Math.round((durations[i] / maxD) * 100),
        cls: t.interrupted ? 'warn' : i === slice.length - 1 ? 'acc' : '',
        idx: turns.length - slice.length + i + 1,
        label: `${durations[i].toFixed(1)}s${t.interrupted ? ' (interrupted)' : ''}`,
      }));
      const avg =
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0;
      setData({
        bars,
        current: turns.length,
        avgLabel: durations.length > 0 ? `avg ${avg.toFixed(1)}s` : '—',
      });
    }
    refresh();
    const t = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [controller.chatId]);

  return data;
}
