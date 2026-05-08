/* Shell — 顶层布局,FileTree + PreviewPane + ChatPane,header 含项目名 + 模型 + 设置 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree } from './FileTree';
import { ChatList } from './ChatList';
import { MidPane } from './MidPane';
import { ChatPane } from './ChatPane';
import { ModelSettings } from '../settings/ModelSettings';
import { exportProjectAsZip } from '../settings/exportProject';
import {
  type ChatController,
  getChatController,
} from '../store/chat';
import { ClientProvider } from '../llm/clientProvider';
import type { LLMProvider } from '../llm/provider';
import {
  ensureCurrentProject,
  listProjects,
  createProject,
  setCurrentProjectId,
  renameProject,
} from '../store/projects';
import { ensureCurrentChat } from '../store/chats';
import type { Project } from '../store/db';
import { ProjectBriefDialog } from './ProjectBriefDialog';

export function Shell() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [stripExport, setStripExport] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>('index.html');

  // === v1.5:provider 是单例 ClientProvider,所有调用走 /api/llm/chat
  const providerRef = useRef<LLMProvider>(new ClientProvider());

  // === Project init ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await ensureCurrentProject();
      const list = await listProjects();
      if (cancelled) return;
      setProjectId(id);
      setProjects(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // === Chat init: 切项目时确保有 chat ===
  useEffect(() => {
    if (projectId == null) return;
    let cancelled = false;
    (async () => {
      const cid = await ensureCurrentChat(projectId);
      if (!cancelled) setChatId(cid);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const controller = useMemo<ChatController | null>(() => {
    if (projectId == null || chatId == null) return null;
    return getChatController(projectId, chatId, () => providerRef.current);
  }, [projectId, chatId]);

  if (projectId == null || !controller) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        loading…
      </div>
    );
  }

  return (
    <ShellInner
      projectId={projectId}
      controller={controller}
      project={projects.find((p) => p.id === projectId)}
      projects={projects}
      onSelectProject={(id) => {
        setCurrentProjectId(id);
        setProjectId(id);
      }}
      onNewProject={async () => {
        const id = await createProject();
        setProjectId(id);
        setProjects(await listProjects());
      }}
      onRename={async (name) => {
        await renameProject(projectId, name);
        setProjects(await listProjects());
      }}
      onExport={async () => {
        const p = projects.find((x) => x.id === projectId);
        await exportProjectAsZip(projectId, p?.name ?? 'project', {
          stripDevMarkers: stripExport,
        });
      }}
      stripExport={stripExport}
      toggleStripExport={() => setStripExport((v) => !v)}
      settingsOpen={settingsOpen}
      openSettings={() => setSettingsOpen(true)}
      closeSettings={() => setSettingsOpen(false)}
      briefOpen={briefOpen}
      openBrief={() => setBriefOpen(true)}
      closeBrief={() => setBriefOpen(false)}
      selectedPath={selectedPath}
      setSelectedPath={setSelectedPath}
      onActivateChat={setChatId}
    />
  );
}

interface ShellInnerProps {
  projectId: number;
  controller: ChatController;
  project?: Project;
  projects: Project[];
  onSelectProject: (id: number) => void;
  onNewProject: () => void;
  onRename: (name: string) => void;
  onExport: () => void;
  stripExport: boolean;
  toggleStripExport: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  briefOpen: boolean;
  openBrief: () => void;
  closeBrief: () => void;
  selectedPath: string;
  setSelectedPath: (p: string) => void;
  onActivateChat: (chatId: number) => void;
}

function ShellInner(props: ShellInnerProps) {
  const {
    controller,
    projectId,
    selectedPath,
    setSelectedPath,
    settingsOpen,
    openSettings,
    closeSettings,
    briefOpen,
    openBrief,
    closeBrief,
    onActivateChat,
  } = props;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header
        project={props.project}
        projects={props.projects}
        onSelectProject={props.onSelectProject}
        onNewProject={props.onNewProject}
        onRename={props.onRename}
        onOpenSettings={openSettings}
        onOpenBrief={openBrief}
        onExport={props.onExport}
        stripExport={props.stripExport}
        toggleStripExport={props.toggleStripExport}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          style={{
            width: 'var(--filetree-w)',
            flex: '0 0 var(--filetree-w)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <ChatList
            projectId={controller.projectId}
            activeChatId={controller.chatId}
            onActivate={onActivateChat}
          />
          <FileTree
            noFrame
            projectId={projectId}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        </div>
        <MidPane
          controller={controller}
          initialPath={
            selectedPath.endsWith('.html') || selectedPath === 'index.html'
              ? selectedPath
              : 'index.html'
          }
        />
        <ChatPane controller={controller} onOpenSettings={openSettings} />
      </div>

      <ModelSettings open={settingsOpen} onClose={closeSettings} />

      <ProjectBriefDialog
        projectId={projectId}
        open={briefOpen}
        onClose={closeBrief}
      />
    </div>
  );
}

function Header({
  project,
  projects,
  onSelectProject,
  onNewProject,
  onRename,
  onOpenSettings,
  onOpenBrief,
  onExport,
  stripExport,
  toggleStripExport,
}: {
  project?: Project;
  projects: Project[];
  onSelectProject: (id: number) => void;
  onNewProject: () => void;
  onRename: (name: string) => void;
  onOpenSettings: () => void;
  onOpenBrief: () => void;
  onExport: () => void;
  stripExport: boolean;
  toggleStripExport: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div
      style={{
        height: 'var(--header-h)',
        flex: '0 0 var(--header-h)',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--sp-4)',
        gap: 'var(--sp-3)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
        ai-design
      </div>
      <div style={{ color: 'var(--border-default)' }}>·</div>

      <select
        value={project?.id ?? ''}
        onChange={(e) => onSelectProject(Number(e.target.value))}
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '4px 8px',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) onRename(draft.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 6px',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-primary)',
          }}
        />
      ) : (
        <button
          onClick={() => {
            setDraft(project?.name ?? '');
            setEditing(true);
          }}
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-xs)',
          }}
          title="改项目名"
        >
          ✎
        </button>
      )}

      <button
        onClick={onOpenBrief}
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-xs)',
          padding: '3px 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
        }}
        title="项目背景(产品 / 用户 / 风格锚点 — 跨任务共享)"
      >
        ⚙ 项目背景
      </button>

      <button
        onClick={onNewProject}
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 'var(--fs-xs)',
        }}
        title="新建项目"
      >
        + 新项目
      </button>

      <div style={{ flex: 1 }} />

      <label
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
        }}
        title="导出时去掉 data-aid 等开发标记"
      >
        <input
          type="checkbox"
          checked={stripExport}
          onChange={toggleStripExport}
        />
        干净版
      </label>
      <button onClick={onExport} style={headerBtn}>
        导出 zip
      </button>
      <button onClick={onOpenSettings} style={headerBtn}>
        设置
      </button>
    </div>
  );
}

const headerBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
};
