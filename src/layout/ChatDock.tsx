/* ChatDock — 右下浮动玻璃 dock,包 ChatPane
 *
 *  状态:
 *    - normal:380×560 浮动,可拖
 *    - minimized:只显示一个 36px 的"恢复"按钮(像 macOS dock icon)
 *
 *  键盘:⌘\ minimize/restore
 *
 *  实现要点:
 *    - position absolute,父容器(canvas-area)需要 position relative
 *    - drag 走 mousedown→mousemove→mouseup 简单实现,不靠库
 *    - 限制不能拖出 canvas-area 边界(简单 clamp)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatController } from '../store/chat';
import { ChatPane } from './ChatPane';

export interface ChatDockProps {
  controller: ChatController;
  onOpenSettings(): void;
}

interface DockPos {
  right: number;
  bottom: number;
}

const DEFAULT_POS: DockPos = { right: 24, bottom: 24 };
const DOCK_W = 408;
const DOCK_H = 568;

export function ChatDock({ controller, onOpenSettings }: ChatDockProps) {
  const [pos, setPos] = useState<DockPos>(DEFAULT_POS);
  const [minimized, setMinimized] = useState(false);
  const dragStart = useRef<{ x: number; y: number; right: number; bottom: number } | null>(
    null
  );

  // ⌘\ 切 minimize
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setMinimized((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onMouseDownHead = useCallback(
    (e: React.MouseEvent) => {
      // 只用左键 drag
      if (e.button !== 0) return;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        right: pos.right,
        bottom: pos.bottom,
      };
      e.preventDefault();
    },
    [pos]
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const s = dragStart.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // right 增加 = 向左移;bottom 增加 = 向上移
      const nextRight = Math.max(8, s.right - dx);
      const nextBottom = Math.max(28, s.bottom - dy); // 留 status bar 22 + 6
      setPos({ right: nextRight, bottom: nextBottom });
    }
    function onUp() {
      dragStart.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="wb-glass"
        style={{
          position: 'absolute',
          right: pos.right,
          bottom: pos.bottom,
          width: 'auto',
          height: 36,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderRadius: 18,
          color: 'var(--text-primary)',
          fontSize: 12,
          cursor: 'pointer',
          zIndex: 30,
          fontFamily: 'var(--font-mono)',
        }}
        title="恢复 chat dock(⌘\\)"
      >
        💬
        <span style={{ color: 'var(--text-tertiary)' }}>chat</span>
        <span className="wb-kbd sm">⌘\</span>
      </button>
    );
  }

  return (
    <div
      className="wb-glass"
      style={{
        position: 'absolute',
        right: pos.right,
        bottom: pos.bottom,
        width: DOCK_W,
        height: DOCK_H,
        maxHeight: 'calc(100% - 40px)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 30,
      }}
    >
      {/* 拖把手 + 控制按钮 */}
      <div
        onMouseDown={onMouseDownHead}
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px 8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <i style={{ width: 14, height: 1, background: 'var(--text-disabled)' }} />
          <i style={{ width: 10, height: 1, background: 'var(--text-disabled)' }} />
          <i style={{ width: 14, height: 1, background: 'var(--text-disabled)' }} />
        </div>
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          chat dock
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="wb-icon-btn"
          onClick={() => setMinimized(true)}
          title="最小化 (⌘\\)"
          style={{ width: 22, height: 22 }}
        >
          ─
        </button>
        <button
          className="wb-icon-btn"
          onClick={() => setPos(DEFAULT_POS)}
          title="复位"
          style={{ width: 22, height: 22 }}
        >
          ⤡
        </button>
      </div>

      {/* 内嵌 ChatPane;它是 flex column,自动撑满剩余 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <DockInnerChat controller={controller} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}

/** 适配 ChatPane 进 dock — ChatPane 之前用 --chat-w 撑宽 + borderLeft,
 *  在 dock 里要让它继承父高度且没 borderLeft */
function DockInnerChat({
  controller,
  onOpenSettings,
}: {
  controller: ChatController;
  onOpenSettings(): void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        // 用 CSS var 覆盖 ChatPane 的内联默认值(走 inline scope)
        ['--chat-w' as any]: '100%',
        ['--chat-bg' as any]: 'transparent',
        ['--chat-border-left' as any]: '0',
        minHeight: 0,
      }}
    >
      <ChatPane controller={controller} onOpenSettings={onOpenSettings} />
    </div>
  );
}
