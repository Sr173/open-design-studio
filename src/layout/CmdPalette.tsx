/* CmdPalette — ⌘K 模糊搜索:文件 / chat / 命令
 *
 *  操作:
 *    ⌘K          → 打开
 *    ↑↓          → 选
 *    ↵           → 打开 / 执行
 *    esc         → 关
 *
 *  来源:
 *    - 文件:.design/ 内 + 用户源码(via listFiles + listSource)
 *    - chats:当前项目所有 chats
 *    - 命令:固定列表(rollback / export / settings / ...)
 *    - 项目:其他项目(切换用)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Project } from '../store/db';
import { db } from '../store/db';
import { listFiles } from '../store/files';
import { native, isElectron } from '../native';
import { listProjects, setCurrentProjectId } from '../store/projects';
import { listChats, setCurrentChatId } from '../store/chats';

export type CmdAction =
  | { kind: 'open-file'; path: string; size?: number }
  | { kind: 'switch-chat'; chatId: number; chatName: string; projectId: number }
  | { kind: 'switch-project'; projectId: number; projectName: string }
  | { kind: 'cmd'; id: string; label: string; shortcut?: string; run: () => void };

export interface CmdPaletteProps {
  open: boolean;
  onClose(): void;
  projectId: number;
  rootPath: string | null;
  onSelectFile(path: string): void;
  onSelectChat(chatId: number): void;
  onSelectProject(projectId: number): void;
  /** 用户在命令面板里能执行的全局命令 */
  commands?: Array<{ id: string; label: string; shortcut?: string; run(): void }>;
}

export function CmdPalette({
  open,
  onClose,
  projectId,
  rootPath,
  onSelectFile,
  onSelectChat,
  onSelectProject,
  commands = [],
}: CmdPaletteProps) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [files, setFiles] = useState<Array<{ path: string; size: number }>>([]);
  const [chats, setChats] = useState<Array<{ id: number; name: string }>>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 重置 + 自动 focus
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // 拉数据(打开时一次,缓存到关闭)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const [f, c, p] = await Promise.all([
        listFiles(projectId).catch(() => []),
        listChats(projectId).catch(() => []),
        listProjects().catch(() => []),
      ]);
      if (!alive) return;
      setFiles(
        f.map((x) => ({ path: x.path, size: x.content?.length ?? 0 }))
      );
      setChats(c.map((x) => ({ id: x.id!, name: x.name })));
      setProjects(p);
    })();
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  // 全局监听 ⌘K(组件外按也能开)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // 让父组件控制 open/close;这里只 emit event
        window.dispatchEvent(new CustomEvent('aid:cmdk-toggle'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 模糊匹配
  const actions = useMemo<CmdAction[]>(() => {
    const q = query.trim().toLowerCase();
    const out: CmdAction[] = [];

    // 文件
    const fileItems = files.map<CmdAction>((f) => ({
      kind: 'open-file',
      path: f.path,
      size: f.size,
    }));
    out.push(...fuzzyRank(fileItems, q, (a) => (a.kind === 'open-file' ? a.path : '')));

    // chats
    const chatItems = chats.map<CmdAction>((c) => ({
      kind: 'switch-chat',
      chatId: c.id,
      chatName: c.name,
      projectId,
    }));
    out.push(...fuzzyRank(chatItems, q, (a) => (a.kind === 'switch-chat' ? a.chatName : '')));

    // 项目
    const projItems = projects
      .filter((p) => p.id !== projectId)
      .map<CmdAction>((p) => ({
        kind: 'switch-project',
        projectId: p.id!,
        projectName: p.name,
      }));
    out.push(...fuzzyRank(projItems, q, (a) => (a.kind === 'switch-project' ? a.projectName : '')));

    // 命令
    const cmdItems = commands.map<CmdAction>((c) => ({
      kind: 'cmd',
      id: c.id,
      label: c.label,
      shortcut: c.shortcut,
      run: c.run,
    }));
    out.push(...fuzzyRank(cmdItems, q, (a) => (a.kind === 'cmd' ? a.label : '')));

    return out.slice(0, 40);
  }, [query, files, chats, projects, commands, projectId]);

  // 选中范围 clamp
  useEffect(() => {
    if (sel >= actions.length) setSel(Math.max(0, actions.length - 1));
  }, [actions.length, sel]);

  const fire = useCallback(
    (a: CmdAction) => {
      if (a.kind === 'open-file') onSelectFile(a.path);
      else if (a.kind === 'switch-chat') {
        setCurrentChatId(a.projectId, a.chatId);
        onSelectChat(a.chatId);
      } else if (a.kind === 'switch-project') {
        setCurrentProjectId(a.projectId);
        onSelectProject(a.projectId);
      } else if (a.kind === 'cmd') a.run();
      onClose();
    },
    [onSelectFile, onSelectChat, onSelectProject, onClose]
  );

  // 分组渲染:文件 / chats / 项目 / 命令(必须在 if(!open) return 之前 — 保 hooks 顺序)
  const groups = useMemo(() => {
    const f = actions.filter((a) => a.kind === 'open-file');
    const c = actions.filter((a) => a.kind === 'switch-chat');
    const p = actions.filter((a) => a.kind === 'switch-project');
    const cmd = actions.filter((a) => a.kind === 'cmd');
    return [
      { title: `文件 · ${f.length}`, items: f },
      { title: `Chats · ${c.length}`, items: c },
      { title: `项目 · ${p.length}`, items: p },
      { title: `命令 · ${cmd.length}`, items: cmd },
    ].filter((g) => g.items.length > 0);
  }, [actions]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((v) => Math.min(actions.length - 1, v + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
    } else if (e.key === 'Enter' && actions[sel]) {
      e.preventDefault();
      fire(actions[sel]);
    }
  }

  // 通过总顺序计算每项的全局 index → 高亮 sel
  let flatIdx = -1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="wb-glass"
        style={{
          width: 580,
          maxWidth: '90vw',
          maxHeight: '70vh',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 输入 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
            placeholder="跳转文件 / chat / 命令 …"
            style={{
              flex: 1,
              fontSize: 16,
              color: 'var(--text-primary)',
              background: 'transparent',
              border: 0,
              outline: 'none',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <span style={{ color: 'var(--text-disabled)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            esc
          </span>
        </div>

        {/* 列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 6px' }}>
          {groups.length === 0 && (
            <div
              style={{
                padding: '20px 16px',
                color: 'var(--text-tertiary)',
                fontSize: 13,
                fontStyle: 'italic',
              }}
            >
              没有匹配项
            </div>
          )}
          {groups.map((g) => (
            <div key={g.title}>
              <div
                style={{
                  padding: '6px 16px 3px',
                  fontSize: 9,
                  color: 'var(--text-disabled)',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{g.title}</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              </div>
              {g.items.map((a) => {
                flatIdx++;
                const isSel = flatIdx === sel;
                return (
                  <CmdRow key={cmdRowKey(a)} action={a} selected={isSel} onClick={() => fire(a)} />
                );
              })}
            </div>
          ))}
        </div>

        {/* footer */}
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '7px 16px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: 9,
            color: 'var(--text-disabled)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <span><span className="wb-kbd sm">↑</span> <span className="wb-kbd sm">↓</span> 选</span>
          <span><span className="wb-kbd sm">↵</span> 打开</span>
          <span style={{ flex: 1 }} />
          <span>{actions.length} matches</span>
        </div>
      </div>
    </div>
  );
}

function CmdRow({
  action,
  selected,
  onClick,
}: {
  action: CmdAction;
  selected: boolean;
  onClick(): void;
}) {
  let ico = '?';
  let name: React.ReactNode = '';
  let meta = '';
  if (action.kind === 'open-file') {
    ico = '📄';
    name = action.path;
    meta = action.size ? `${(action.size / 1024).toFixed(1)}kb` : '';
  } else if (action.kind === 'switch-chat') {
    ico = '💬';
    name = action.chatName;
    meta = '';
  } else if (action.kind === 'switch-project') {
    ico = '📂';
    name = action.projectName;
    meta = 'project';
  } else if (action.kind === 'cmd') {
    ico = '⚡';
    name = action.label;
    meta = action.shortcut ?? '';
  }
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 16px',
        width: '100%',
        fontSize: 13,
        color: 'var(--text-primary)',
        background: selected ? 'rgba(255,164,81,0.14)' : 'transparent',
        border: 0,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 4,
          background: selected ? 'rgba(0,0,0,0.2)' : 'var(--bg-base)',
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {ico}
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: selected ? '#fff' : 'var(--text-primary)',
          fontFamily: action.kind === 'open-file' ? 'var(--font-mono)' : 'var(--font-ui)',
          fontSize: action.kind === 'open-file' ? 12 : 13,
        }}
      >
        {name}
      </span>
      {meta && (
        <span
          style={{
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          {meta}
        </span>
      )}
    </button>
  );
}

function cmdRowKey(a: CmdAction): string {
  switch (a.kind) {
    case 'open-file':
      return `f:${a.path}`;
    case 'switch-chat':
      return `c:${a.chatId}`;
    case 'switch-project':
      return `p:${a.projectId}`;
    case 'cmd':
      return `x:${a.id}`;
  }
}

/** 极简模糊匹配:子串包含 → 加分;前缀匹配 → 加更多;空 query 全过 */
function fuzzyRank<T>(items: T[], query: string, getText: (t: T) => string): T[] {
  if (!query) return items;
  const scored: Array<{ t: T; s: number }> = [];
  for (const t of items) {
    const text = getText(t).toLowerCase();
    if (!text) continue;
    let s = 0;
    if (text === query) s = 1000;
    else if (text.startsWith(query)) s = 500;
    else if (text.includes(query)) s = 200;
    else {
      // 字符序匹配(subsequence)
      let qi = 0;
      for (let i = 0; i < text.length && qi < query.length; i++) {
        if (text[i] === query[qi]) qi++;
      }
      if (qi === query.length) s = 50 - text.length * 0.1;
    }
    if (s > 0) scored.push({ t, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.t);
}
