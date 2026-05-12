/* RailSidebar — 56px 左侧 icon rail(variant A · sidebar-companion 风)
 *
 *  - 📂 项目 & chats(展开 flyout — 跟之前 ProjectsSidebar 一个模型,但只在 hover/click 时显示)
 *  - 📄 文件 — flyout 显示 .design/ 文件树
 *  - 🔍 搜索 — 打 ⌘K(其实就是 CmdPalette 入口)
 *  - 🎛 Tweak 控件 — flyout 显示 TweaksPanel
 *  - 🖼 附件
 *  ─ 中间 spacer ─
 *  - ⚙ 设置
 *  - ↗ 导出 / 项目背景
 *
 *  active 状态:当前 rail 项左侧有 2px 橙竖条
 */

import { useEffect, useRef, useState } from 'react';
import type { Project, Chat } from '../store/db';
import { listProjects, setCurrentProjectId, createProject, deleteProject, renameProject } from '../store/projects';
import { listChats, setCurrentChatId, deleteChat } from '../store/chats';
import { NewProjectDialog } from './NewProjectDialog';
import { NewTaskDialog } from './NewTaskDialog';
import { getRunningChatId, onProjectLockChange } from '../store/chat';

export type RailTab = 'projects' | 'files' | 'tweaks' | 'uploads' | null;

export interface RailSidebarProps {
  activeProjectId: number;
  activeChatId: number | null;
  onSelectProject(id: number): void;
  onSelectChat(id: number): void;
  onOpenCmdPalette(): void;
  onOpenSettings(): void;
  onOpenBrief(): void;
  onExport(): void;
}

export function RailSidebar({
  activeProjectId,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onOpenCmdPalette,
  onOpenSettings,
  onOpenBrief,
  onExport,
}: RailSidebarProps) {
  const [tab, setTab] = useState<RailTab>(null);
  const railRef = useRef<HTMLDivElement>(null);

  function toggle(t: RailTab) {
    setTab((prev) => (prev === t ? null : t));
  }

  // 点 rail 外 → 关 flyout
  useEffect(() => {
    if (!tab) return;
    function onDocClick(e: MouseEvent) {
      if (!railRef.current) return;
      const target = e.target as Node;
      if (railRef.current.contains(target)) return;
      // flyout 自己有 stopPropagation;漏出去的就关
      setTab(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [tab]);

  return (
    <div
      ref={railRef}
      style={{
        flex: '0 0 56px',
        width: 56,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
        gap: 2,
        overflow: 'visible',
        position: 'relative',
        zIndex: 50,
      }}
    >
      <RailBtn icon="📂" title="项目 & chats" active={tab === 'projects'} onClick={() => toggle('projects')} />
      <RailBtn icon="📄" title="文件" active={tab === 'files'} onClick={() => toggle('files')} />
      <RailBtn icon="🔍" title="搜索 (⌘K)" onClick={onOpenCmdPalette} />
      <RailBtn icon="🎛" title="Tweak 控件" active={tab === 'tweaks'} onClick={() => toggle('tweaks')} />
      <RailBtn icon="🖼" title="附件 / uploads" active={tab === 'uploads'} onClick={() => toggle('uploads')} />

      <div style={{ flex: 1 }} />

      <RailBtn icon="⚙" title="模型设置" onClick={onOpenSettings} />
      <RailBtn icon="✎" title="项目背景 brief" onClick={onOpenBrief} />
      <RailBtn icon="↗" title="导出 .design 为 zip" onClick={onExport} />

      {/* flyouts */}
      {tab === 'projects' && (
        <ProjectsFlyout
          activeProjectId={activeProjectId}
          activeChatId={activeChatId}
          onSelectProject={(id) => {
            onSelectProject(id);
            setTab(null);
          }}
          onSelectChat={(id) => {
            onSelectChat(id);
            setTab(null);
          }}
          onChangedProjects={() => {}}
        />
      )}

      {tab === 'files' && (
        <FilesFlyout projectId={activeProjectId} onClose={() => setTab(null)} />
      )}

      {tab === 'tweaks' && (
        <SimpleFlyout title="Tweak 控件">
          <div style={{ color: 'var(--text-tertiary)', fontSize: 12, fontStyle: 'italic', padding: '8px 4px' }}>
            (AI 在源文件里写 `&lt;!-- TWEAK ... --&gt;` marker 后这里会出现可拉的控件 — 还没适配新布局)
          </div>
        </SimpleFlyout>
      )}

      {tab === 'uploads' && (
        <SimpleFlyout title="附件 / uploads">
          <div style={{ color: 'var(--text-tertiary)', fontSize: 12, fontStyle: 'italic', padding: '8px 4px' }}>
            (拖图到 chat 输入框 = vision;拖到这里 = 进 uploads/ 项目资源 — 还没适配新布局)
          </div>
        </SimpleFlyout>
      )}
    </div>
  );
}

function RailBtn({
  icon,
  title,
  active,
  onClick,
  badge,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onClick(): void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height: 40,
        width: 40,
        margin: '0 auto',
        borderRadius: 'var(--radius-sm)',
        display: 'grid',
        placeItems: 'center',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        background: active ? 'rgba(255,164,81,0.14)' : 'transparent',
        fontSize: 16,
        position: 'relative',
        border: 0,
        cursor: 'pointer',
        transition: 'background 100ms, color 100ms',
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)';
        (e.currentTarget as HTMLElement).style.color = active ? 'var(--accent)' : 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = active ? 'var(--accent)' : 'var(--text-tertiary)';
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 2,
            height: 18,
            background: 'var(--accent)',
            borderRadius: '0 2px 2px 0',
          }}
        />
      )}
      <span>{icon}</span>
      {badge != null && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 14,
            height: 14,
            padding: '0 4px',
            borderRadius: 7,
            background: 'var(--accent)',
            color: '#000',
            fontSize: 9,
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================
// Projects flyout — 项目 + chats 二级展开
// ============================================================

function ProjectsFlyout({
  activeProjectId,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onChangedProjects,
}: {
  activeProjectId: number;
  activeChatId: number | null;
  onSelectProject(id: number): void;
  onSelectChat(id: number): void;
  onChangedProjects(): void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    listProjects().then(setProjects);
  }, [bump]);

  return (
    <FlyoutShell title="项目">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {projects.length === 0 && (
          <div style={{ padding: '8px 6px', fontSize: 12, color: 'var(--text-tertiary)' }}>
            没有项目
          </div>
        )}
        {projects.map((p) => (
          <ProjectGroup
            key={p.id}
            project={p}
            isActive={p.id === activeProjectId}
            activeChatId={activeChatId}
            onSelectProject={onSelectProject}
            onSelectChat={onSelectChat}
            onChanged={() => {
              setBump((v) => v + 1);
              onChangedProjects();
            }}
          />
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 6, paddingTop: 6 }}>
        <button
          onClick={() => setNewProjectOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            background: 'transparent',
            color: 'var(--accent)',
            border: 0,
            fontSize: 12,
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          ＋ 新建项目
        </button>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={async ({ name, rootPath }) => {
          const id = await createProject(name, rootPath);
          setBump((v) => v + 1);
          onSelectProject(id);
        }}
      />
    </FlyoutShell>
  );
}

function ProjectGroup({
  project,
  isActive,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onChanged,
}: {
  project: Project;
  isActive: boolean;
  activeChatId: number | null;
  onSelectProject(id: number): void;
  onSelectChat(id: number): void;
  onChanged(): void;
}) {
  const [expanded, setExpanded] = useState(isActive);
  const [chats, setChats] = useState<Chat[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [runningChatId, setRunningChatId] = useState<number | null>(null);

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  useEffect(() => {
    if (!expanded || project.id == null) return;
    let alive = true;
    const refresh = async () => {
      const list = await listChats(project.id!);
      if (alive) setChats(list.reverse());
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [expanded, project.id]);

  useEffect(() => {
    if (project.id == null) return;
    setRunningChatId(getRunningChatId(project.id));
    return onProjectLockChange((pid) => {
      if (pid === project.id) setRunningChatId(getRunningChatId(pid));
    });
  }, [project.id]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 6px',
          borderRadius: 4,
          cursor: 'pointer',
          background: isActive ? 'rgba(255,164,81,0.08)' : 'transparent',
        }}
        onClick={() => {
          if (project.id != null) onSelectProject(project.id);
          setExpanded(true);
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            width: 14,
            color: 'var(--text-tertiary)',
            fontSize: 9,
            background: 'transparent',
            border: 0,
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span style={{ fontSize: 12 }}>{project.rootPath ? '📂' : '⚠'}</span>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={async () => {
              if (draft.trim() && project.id != null) {
                await renameProject(project.id, draft.trim());
                onChanged();
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              border: '1px solid var(--accent)',
              borderRadius: 3,
              padding: '1px 4px',
              fontSize: 12,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        ) : (
          <span
            title={project.rootPath ?? '虚拟项目(IDB)'}
            style={{
              flex: 1,
              fontSize: 12,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: isActive ? 500 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {project.name}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDraft(project.name);
            setRenaming(true);
          }}
          style={miniBtn}
          title="改名"
        >
          ✎
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (project.id == null) return;
            if (
              !window.confirm(
                `删除 "${project.name}"?${project.rootPath ? '本地文件夹不会被删,只解绑。' : ''}`
              )
            )
              return;
            await deleteProject(project.id);
            onChanged();
          }}
          style={miniBtn}
          title="删除"
        >
          ✕
        </button>
      </div>
      {expanded && (
        <div style={{ marginLeft: 20, marginTop: 2 }}>
          {chats.length === 0 && (
            <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
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
                if (!confirm('删除这个 chat?')) return;
                await deleteChat(c.id);
                const after = await listChats(project.id!);
                setChats(after.reverse());
                if (c.id === activeChatId && after[0]?.id != null) {
                  onSelectChat(after[0].id);
                }
              }}
            />
          ))}
          {isActive && (
            <button
              onClick={() => setNewTaskOpen(true)}
              style={{
                width: 'calc(100% - 4px)',
                padding: '4px 6px',
                marginTop: 2,
                background: 'transparent',
                border: '1px dashed var(--border-subtle)',
                borderRadius: 3,
                color: 'var(--text-tertiary)',
                fontSize: 11,
                cursor: 'pointer',
                textAlign: 'left',
              }}
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
        gap: 5,
        padding: '3px 6px',
        margin: '1px 0',
        borderRadius: 3,
        cursor: 'pointer',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        fontSize: 11,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
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
            flexShrink: 0,
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
        style={{ ...miniBtn, opacity: active ? 0.7 : 0.3, fontSize: 9 }}
      >
        ✕
      </button>
    </div>
  );
}

// ============================================================
// Files flyout
// ============================================================

import { FileTree } from './FileTree';

function FilesFlyout({ projectId, onClose: _ }: { projectId: number; onClose(): void }) {
  const [selected, setSelected] = useState('index.html');
  return (
    <FlyoutShell title=".design 文件">
      <FileTree noFrame projectId={projectId} selectedPath={selected} onSelect={setSelected} />
    </FlyoutShell>
  );
}

// ============================================================
// Generic Flyout chrome
// ============================================================

function FlyoutShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 8,
        left: 56,
        width: 280,
        maxHeight: '80vh',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>{children}</div>
    </div>
  );
}

function SimpleFlyout({ title, children }: { title: string; children: React.ReactNode }) {
  return <FlyoutShell title={title}>{children}</FlyoutShell>;
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes wb-rail-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          border: '1.5px solid var(--border-default)',
          borderTopColor: 'var(--accent)',
          animation: 'wb-rail-spin 0.7s linear infinite',
          flexShrink: 0,
        }}
      />
    </>
  );
}

const miniBtn: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 10,
  padding: '0 2px',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};
