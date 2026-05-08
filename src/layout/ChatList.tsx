/* ChatList — 项目内多 chat 会话列表(左栏上方一小块)
 *
 * 切换 chat 不影响文件 / 预览(项目级共享)。
 * 当前正在跑 turn 的 chat 标橘色 dot;锁住其他切换会等。
 */

import { useEffect, useState } from 'react';
import {
  listChats,
  renameChat,
  deleteChat,
  setCurrentChatId,
} from '../store/chats';
import type { Chat } from '../store/db';
import {
  getRunningChatId,
  onProjectLockChange,
} from '../store/chat';
import { NewTaskDialog } from './NewTaskDialog';

export function ChatList({
  projectId,
  activeChatId,
  onActivate,
}: {
  projectId: number;
  activeChatId: number | null;
  onActivate: (chatId: number) => void;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [runningChatId, setRunningChatId] = useState<number | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  // 拉 chats 列表 + 监听 db.messages 变化(message 变更触发 touchChat 改 updatedAt)
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await listChats(projectId);
      if (!cancelled) setChats(list.reverse()); // 最近活跃在上
    };
    refresh();
    // poll-light:1.5s 刷一次,简单稳健;后续可以挂 Dexie observable
    const t = setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId]);

  // 监听项目锁
  useEffect(() => {
    setRunningChatId(getRunningChatId(projectId));
    return onProjectLockChange((pid) => {
      if (pid === projectId) setRunningChatId(getRunningChatId(projectId));
    });
  }, [projectId]);

  function handleCreate() {
    setTaskDialogOpen(true);
  }

  async function handleRename(id: number, name: string) {
    if (!name.trim()) return;
    await renameChat(id, name.trim());
    setChats(await listChats(projectId).then((l) => l.reverse()));
  }

  async function handleDelete(id: number) {
    const all = await listChats(projectId);
    if (all.length <= 1) {
      // 不能删最后一个
      window.alert('至少要保留一个 chat');
      return;
    }
    if (!window.confirm('删除这个 chat?(消息和该 chat 的 snapshot 会清掉,文件保留)')) return;
    await deleteChat(id);
    const after = await listChats(projectId);
    if (activeChatId === id && after[0]?.id != null) {
      onActivate(after[0].id);
    }
    setChats(after.reverse());
  }

  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-default)',
        maxHeight: '40%',
      }}
    >
      <div
        style={{
          padding: 'var(--sp-3)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span>tasks</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={handleCreate}
          style={{
            padding: '3px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: '#1a1410',
            fontSize: 'var(--fs-xs)',
            fontWeight: 600,
            fontFamily: 'var(--font-ui)',
          }}
          title="新建任务"
        >
          + 新任务
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--sp-1) var(--sp-1)',
        }}
      >
        {chats.length === 0 && (
          <div
            style={{
              padding: 'var(--sp-3)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            (空)
          </div>
        )}
        {chats.map((c) =>
          editingId === c.id ? (
            <input
              key={c.id}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (c.id != null) handleRename(c.id, draft);
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingId(null);
              }}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-xs)',
                padding: '4px 6px',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-primary)',
              }}
            />
          ) : (
            <ChatRow
              key={c.id}
              chat={c}
              active={activeChatId === c.id}
              running={runningChatId === c.id}
              onClick={() => {
                if (c.id != null) {
                  setCurrentChatId(projectId, c.id);
                  onActivate(c.id);
                }
              }}
              onRename={() => {
                setDraft(c.name);
                setEditingId(c.id ?? null);
              }}
              onDelete={() => c.id != null && handleDelete(c.id)}
            />
          )
        )}
      </div>

      <NewTaskDialog
        projectId={projectId}
        open={taskDialogOpen}
        onClose={() => setTaskDialogOpen(false)}
        onCreated={(cid) => {
          onActivate(cid);
        }}
      />
    </div>
  );
}

function ChatRow({
  chat,
  active,
  running,
  onClick,
  onRename,
  onDelete,
}: {
  chat: Chat;
  active: boolean;
  running: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        margin: '1px 0',
        borderRadius: 'var(--radius-xs)',
        cursor: 'pointer',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        fontSize: 'var(--fs-xs)',
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background =
            'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {running ? (
        <Spinner />
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: active ? 'var(--accent)' : 'var(--text-disabled)',
            flex: '0 0 auto',
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        title={chat.name}
      >
        {chat.name}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 10,
          opacity: active ? 1 : 0.5,
          padding: '0 2px',
        }}
        title="删除"
      >
        ✕
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes aidChatSpin { to { transform: rotate(360deg); } }`}</style>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          border: '1.5px solid var(--border-default)',
          borderTopColor: 'var(--accent)',
          animation: 'aidChatSpin 0.7s linear infinite',
          flex: '0 0 auto',
        }}
      />
    </>
  );
}
