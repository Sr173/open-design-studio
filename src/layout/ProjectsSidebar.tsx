/* ProjectsSidebar — Claude-Desktop 风格的左侧栏
 *
 * 顶部:全局动作(新建项目 / 搜索)
 * 中间:项目列表,每个可展开看 chats(当前项目自动展开)
 * 底部:文件树(给当前项目)+ 设置等全局按钮
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  listProjects,
  renameProject,
  deleteProject,
  setCurrentProjectId,
} from '../store/projects';
import {
  listChats,
  renameChat,
  deleteChat,
  setCurrentChatId,
} from '../store/chats';
import type { Project, Chat } from '../store/db';
import {
  getRunningChatId,
  onProjectLockChange,
} from '../store/chat';
import { NewProjectDialog } from './NewProjectDialog';
import { NewTaskDialog } from './NewTaskDialog';
import { createProject, setProjectRoot } from '../store/projects';
import { native, isElectron } from '../native';
import { invalidateRootPathCache } from '../store/files';

interface ProjectsSidebarProps {
  activeProjectId: number;
  activeChatId: number | null;
  onSelectProject(id: number): void;
  onSelectChat(chatId: number): void;
  onProjectsChanged?(): void;
  onOpenSettings(): void;
  onOpenBrief(): void;
  onExport(): void;
  stripExport: boolean;
  toggleStripExport(): void;
}

export function ProjectsSidebar({
  activeProjectId,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onProjectsChanged,
  onOpenSettings,
  onOpenBrief,
  onExport,
  stripExport,
  toggleStripExport,
}: ProjectsSidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // 重新加载项目列表
  const refreshProjects = useMemo(
    () => async () => {
      const list = await listProjects();
      setProjects(list);
    },
    []
  );

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  return (
    <div
      style={{
        width: 280,
        flex: '0 0 280px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* 顶部:brand + 全局动作 */}
      <div
        style={{
          flex: '0 0 auto',
          padding: '12px 12px 8px 14px',
          // macOS hiddenInset 标题栏给红绿灯按钮预留空间
          paddingTop: typeof process !== 'undefined' && (process as any).platform === 'darwin' ? 28 : 12,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '0.05em',
            marginBottom: 10,
          }}
        >
          ai-design
        </div>
        <button
          onClick={() => setNewProjectOpen(true)}
          style={topBtn}
          title="新建项目"
        >
          <span>＋</span>
          <span>新建项目</span>
        </button>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          style={{
            ...topBtn,
            color: searchOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
          title="搜索项目"
        >
          <span>🔍</span>
          <span>搜索</span>
        </button>
        {searchOpen && (
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按项目名筛选…"
            style={{
              width: '100%',
              marginTop: 6,
              padding: '4px 8px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false);
                setSearch('');
              }
            }}
          />
        )}
      </div>

      {/* 中间:项目列表 */}
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: '4px 6px 8px',
        }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            没有项目。点上方"新建项目"开始。
          </div>
        )}
        {filtered.map((p) => (
          <ProjectGroup
            key={p.id}
            project={p}
            expanded={p.id === activeProjectId}
            activeChatId={activeChatId}
            onSelectProject={(id) => {
              setCurrentProjectId(id);
              onSelectProject(id);
            }}
            onSelectChat={onSelectChat}
            onProjectsChanged={async () => {
              await refreshProjects();
              onProjectsChanged?.();
            }}
          />
        ))}
      </div>

      {/* 底部:全局动作 */}
      <div
        style={{
          flex: '0 0 auto',
          borderTop: '1px solid var(--border-subtle)',
          padding: '8px 6px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <BottomBtn icon="⚙" label="项目背景" onClick={onOpenBrief} />
        <BottomBtn icon="⤓" label="导出 zip" onClick={onExport} hint={stripExport ? '将清掉开发标记' : undefined} />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            marginLeft: 22,
          }}
        >
          <input type="checkbox" checked={stripExport} onChange={toggleStripExport} />
          导出时清掉开发标记
        </label>
        <BottomBtn icon="⚙" label="设置" onClick={onOpenSettings} />
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={async ({ name, rootPath }) => {
          const id = await createProject(name, rootPath);
          await refreshProjects();
          onProjectsChanged?.();
          onSelectProject(id);
        }}
      />
    </div>
  );
}

function ProjectGroup({
  project,
  expanded: initiallyExpanded,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onProjectsChanged,
}: {
  project: Project;
  expanded: boolean;
  activeChatId: number | null;
  onSelectProject(id: number): void;
  onSelectChat(chatId: number): void;
  onProjectsChanged(): void;
}) {
  // 当前项目自动展开;非当前可手动展开
  const [expanded, setExpanded] = useState(initiallyExpanded);
  useEffect(() => {
    if (initiallyExpanded) setExpanded(true);
  }, [initiallyExpanded]);

  const [chats, setChats] = useState<Chat[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [runningChatId, setRunningChatId] = useState<number | null>(null);

  // 仅展开时拉 chat 列表(节流 1.5s)
  useEffect(() => {
    if (!expanded || project.id == null) return;
    let cancelled = false;
    const refresh = async () => {
      const list = await listChats(project.id!);
      if (!cancelled) setChats(list.reverse());
    };
    refresh();
    const t = setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [expanded, project.id]);

  // 项目锁
  useEffect(() => {
    if (project.id == null) return;
    setRunningChatId(getRunningChatId(project.id));
    return onProjectLockChange((pid) => {
      if (pid === project.id) setRunningChatId(getRunningChatId(pid));
    });
  }, [project.id]);

  const isActive = initiallyExpanded;
  const isUnbound = !project.rootPath;
  const folderIcon = project.rootPath ? '📂' : '⚠';

  async function bindFolder() {
    if (!isElectron() || project.id == null) return;
    const n = native();
    if (!n) return;
    const p = await n.dialog.pickDirectory();
    if (!p) return;
    try {
      await n.fs.validateRoot(p);
      await setProjectRoot(project.id, p);
      invalidateRootPathCache(project.id);
      onProjectsChanged();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  }

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          background: isActive ? 'rgba(255, 164, 81, 0.08)' : 'transparent',
        }}
        onClick={() => {
          if (project.id != null) onSelectProject(project.id);
          setExpanded(true);
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.background =
              'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            width: 16,
            height: 16,
            fontSize: 10,
            color: 'var(--text-tertiary)',
            background: 'transparent',
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span style={{ fontSize: 12 }}>{folderIcon}</span>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={async () => {
              if (draft.trim() && project.id != null) {
                await renameProject(project.id, draft.trim());
                onProjectsChanged();
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setRenaming(false);
                setDraft(project.name);
              }
            }}
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              border: '1px solid var(--accent)',
              borderRadius: 3,
              padding: '1px 4px',
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: isUnbound
                ? 'var(--text-tertiary)'
                : isActive
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
              fontWeight: isActive ? 500 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontStyle: isUnbound ? 'italic' : 'normal',
            }}
            title={
              project.rootPath ??
              '⚠ 此项目还没绑定本地文件夹 — 旧版本遗留,点 🔗 绑定一个新文件夹'
            }
          >
            {project.name}
            {isUnbound && (
              <span style={{ color: 'var(--warning, #d97706)', marginLeft: 4, fontSize: 10 }}>
                · 未绑定
              </span>
            )}
          </span>
        )}
        {isUnbound && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              bindFolder();
            }}
            style={{
              color: 'var(--warning, #d97706)',
              fontSize: 11,
              padding: '0 4px',
            }}
            title="给此项目绑定本地文件夹"
          >
            🔗
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDraft(project.name);
            setRenaming(true);
          }}
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 11,
            opacity: 0.6,
            padding: '0 2px',
          }}
          title="改名"
        >
          ✎
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (project.id == null) return;
            if (!window.confirm(`删除项目 "${project.name}"?所有 chat / 消息会清掉。${project.rootPath ? '本地文件夹不会被删,只是断开绑定。' : ''}`)) {
              return;
            }
            await deleteProject(project.id);
            onProjectsChanged();
          }}
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 11,
            opacity: 0,
            padding: '0 2px',
            transition: 'opacity 80ms',
          }}
          className="aid-project-delete"
          title="删除项目"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div style={{ marginLeft: 22, marginTop: 2 }}>
          {chats.length === 0 && (
            <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              (空)
            </div>
          )}
          {chats.map((c) => (
            <ChatRow
              key={c.id}
              chat={c}
              active={c.id === activeChatId}
              running={c.id === runningChatId}
              onClick={() => {
                if (c.id != null && project.id != null) {
                  setCurrentChatId(project.id, c.id);
                  onSelectChat(c.id);
                }
              }}
              onDelete={async () => {
                if (c.id == null) return;
                const all = await listChats(project.id!);
                if (all.length <= 1) {
                  alert('至少保留一个 chat');
                  return;
                }
                if (!confirm('删除这个 chat?消息会清掉,文件保留')) return;
                await deleteChat(c.id);
                const after = await listChats(project.id!);
                setChats(after.reverse());
                if (c.id === activeChatId && after[0]?.id != null) {
                  setCurrentChatId(project.id!, after[0].id);
                  onSelectChat(after[0].id);
                }
              }}
            />
          ))}
          {isActive && (
            <button
              onClick={() => setNewTaskOpen(true)}
              style={newTaskBtn}
              title="给本项目开新 chat / 新任务"
            >
              ＋ 新任务
            </button>
          )}
        </div>
      )}

      {newTaskOpen && project.id != null && (
        <NewTaskDialog
          projectId={project.id}
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          onCreated={(cid) => onSelectChat(cid)}
        />
      )}
    </div>
  );
}

function ChatRow({
  chat,
  active,
  running,
  onClick,
  onDelete,
}: {
  chat: Chat;
  active: boolean;
  running: boolean;
  onClick(): void;
  onDelete(): void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        margin: '1px 0',
        borderRadius: 3,
        cursor: 'pointer',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        fontSize: 11,
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
            width: 5,
            height: 5,
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
          fontSize: 9,
          opacity: active ? 0.7 : 0.3,
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
      <style>{`@keyframes aidSpin { to { transform: rotate(360deg); } }`}</style>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          border: '1.5px solid var(--border-default)',
          borderTopColor: 'var(--accent)',
          animation: 'aidSpin 0.7s linear infinite',
          flex: '0 0 auto',
        }}
      />
    </>
  );
}

function BottomBtn({
  icon,
  label,
  onClick,
  hint,
}: {
  icon: string;
  label: string;
  onClick(): void;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-secondary)',
        fontSize: 12,
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <span style={{ width: 14, fontSize: 12, color: 'var(--text-tertiary)' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const topBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '5px 8px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 4,
  marginBottom: 2,
};

const newTaskBtn: React.CSSProperties = {
  display: 'block',
  width: 'calc(100% - 4px)',
  padding: '4px 8px',
  marginTop: 2,
  background: 'transparent',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 3,
  color: 'var(--text-tertiary)',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
};
