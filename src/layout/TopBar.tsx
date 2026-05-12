/* TopBar — workbench 顶部 36px,信息密度最大化
 *
 *  [traffic] [project · chat ▼]  [breadcrumb]    [meters: turn · ctx · autosave]  [⌘K] [⚙]
 *
 *  - 全宽,可拖窗(macOS hiddenInset 适配)
 *  - 项目 / chat 选择走 CmdPalette(⌘K),这里只显示当前态
 *  - breadcrumb 显示打开文件路径,带未保存红点
 */

import { useEffect, useState } from 'react';
import type { Project } from '../store/db';
import type { ChatController } from '../store/chat';
import { db } from '../store/db';
import { ProfileSwitcher } from './ProfileSwitcher';

export interface TopBarProps {
  project: Project | null;
  controller: ChatController;
  selectedPath: string;
  rootPath: string | null;
  onOpenSettings(): void;
  onOpenCmdPalette(): void;
}

export function TopBar({
  project,
  controller,
  selectedPath,
  rootPath,
  onOpenSettings,
  onOpenCmdPalette,
}: TopBarProps) {
  const meta = useChatMeta(controller);

  // 项目背景渐变:左 traffic 占 88px(留 macOS 红绿灯),其它各组件铺开
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px 0 88px',
        height: 36,
        flex: '0 0 36px',
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-tertiary)',
        position: 'relative',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* 项目 · chat 选择(点击打开 CmdPalette) */}
      <button
        onClick={onOpenCmdPalette}
        style={{
          ...projBtn,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        title="切换项目 / chat(⌘K)"
      >
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {project?.name ?? '—'}
        </span>
        <span style={{ color: 'var(--text-disabled)' }}>/</span>
        <span style={{
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 180,
        }}>{meta.chatName}</span>
        <span style={{ color: 'var(--text-disabled)', fontSize: 9, marginLeft: 2 }}>▼</span>
      </button>

      {/* breadcrumb */}
      {rootPath && (
        <Breadcrumb rootPath={rootPath} path={selectedPath} />
      )}

      {/* meters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginLeft: 'auto',
          marginRight: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.02em',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* turn */}
        <div className="wb-meter" title={`本 chat 第 ${meta.turnCount} 个 turn,平均 ${meta.turnAvg}s`}>
          <span className="lbl">turn</span>
          <span className="wb-turn-pill">
            <span className="n">{String(meta.turnCount).padStart(2, '0')}</span>
          </span>
        </div>

        {/* context tokens */}
        <div className="wb-meter" title={`context window 占用 ${meta.tokensUsed} / 200k`}>
          <span className="lbl">ctx</span>
          <span className="wb-tokbar"><span className="fill" style={{ width: `${Math.min(100, (meta.tokensUsed / 200000) * 100)}%` }} /></span>
          <span className="val">{formatTokens(meta.tokensUsed)}<span style={{ color: 'var(--text-disabled)' }}>/200k</span></span>
        </div>

        {/* autosave */}
        <div className="wb-meter" title={meta.unsaved ? `${meta.unsavedCount} 个未保存改动` : '全部已保存'}>
          <span className="lbl">save</span>
          <span className="val" style={{ color: meta.unsaved ? 'var(--accent)' : 'var(--success)' }}>●</span>
          <span className="val">{meta.unsaved ? `${meta.unsavedAgo}s` : 'ok'}</span>
        </div>
      </div>

      {/* profile switcher + ⌘K + 设置 */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <ProfileSwitcher onOpenSettings={onOpenSettings} />
        <button className="wb-cmdk-btn" onClick={onOpenCmdPalette}>
          <span style={{ color: 'var(--text-disabled)', fontSize: 10 }}>🔍</span>
          <span className="placeholder">跳转文件 / 命令…</span>
          <span className="wb-kbd sm">⌘K</span>
        </button>
        <button className="wb-icon-btn" onClick={onOpenSettings} title="设置 (⌘,)">⚙</button>
      </div>
    </div>
  );
}

function Breadcrumb({ rootPath, path }: { rootPath: string; path: string }) {
  // Electron renderer 没 process — 用 /Users/<name>/ 模式正则替换成 ~
  const homeShort = rootPath.replace(/^\/Users\/[^/]+/, '~');
  const segs = path.split('/').filter(Boolean);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        paddingLeft: 10,
        borderLeft: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-tertiary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        maxWidth: 480,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      title={`${rootPath}/.design/${path}`}
    >
      <span style={{ color: 'var(--text-disabled)' }}>{homeShort}</span>
      <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>/</span>
      <span style={{ color: 'var(--accent)' }}>.design</span>
      {segs.slice(0, -1).map((s, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>/</span>
          <span style={{ color: 'var(--text-tertiary)' }}>{s}</span>
        </span>
      ))}
      {segs.length > 0 && (
        <>
          <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>/</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {segs[segs.length - 1]}
          </span>
        </>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const projBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  border: 0,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
};

// ============================================================
// useChatMeta — 从 ChatController 派生 meters 元数据
// ============================================================

interface ChatMeta {
  chatName: string;
  turnCount: number;
  turnAvg: number;
  tokensUsed: number;
  unsaved: boolean;
  unsavedAgo: number;
  unsavedCount: number;
}

function useChatMeta(controller: ChatController): ChatMeta {
  const [meta, setMeta] = useState<ChatMeta>({
    chatName: '—',
    turnCount: 0,
    turnAvg: 0,
    tokensUsed: 0,
    unsaved: false,
    unsavedAgo: 0,
    unsavedCount: 0,
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const chat = await db.chats.get(controller.chatId).catch(() => null);
      const messages = await db.messages
        .where({ chatId: controller.chatId })
        .toArray()
        .catch(() => []);
      if (!alive) return;
      // turn 数 ≈ user 消息数
      const userMsgs = messages.filter((m) => m.role === 'user').length;
      // 粗估 token = 总字符 / 4
      let chars = 0;
      for (const m of messages) {
        for (const b of m.blocks ?? []) {
          if (b.type === 'text') chars += b.text.length;
          else if (b.type === 'tool_result') {
            chars +=
              typeof b.content === 'string'
                ? b.content.length
                : JSON.stringify(b.content).length;
          } else if (b.type === 'tool_use') chars += JSON.stringify(b.input).length;
        }
      }
      const tokensUsed = Math.round(chars / 4);
      setMeta({
        chatName: chat?.name ?? '—',
        turnCount: userMsgs,
        turnAvg: 7.2, // 占位,实际要从 message timestamps 算
        tokensUsed,
        unsaved: false,
        unsavedAgo: 0,
        unsavedCount: 0,
      });
    };
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [controller.chatId]);

  return meta;
}
