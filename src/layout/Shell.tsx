/* Shell — 顶层布局
 *  左:ProjectsSidebar(项目 + chats 嵌套 + 设置)
 *  中:MidPane(预览 / Questions)
 *  右:ChatPane
 *
 *  顶部:slim 标题条(项目名 + git 状态 + 路径),没有按钮,所有按钮去左侧栏
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree } from './FileTree';
import { ProjectsSidebar } from './ProjectsSidebar';
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
} from '../store/projects';
import { ensureCurrentChat } from '../store/chats';
import type { Project } from '../store/db';
import { ProjectBriefDialog } from './ProjectBriefDialog';
import { useProjectWatcher } from '../native/useProjectWatcher';
import { GitStatusBadge } from './GitStatusBadge';
import { getProjectRoot } from '../store/files';
import { db } from '../store/db';

export function Shell() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [stripExport, setStripExport] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>('index.html');
  const [projectsBump, setProjectsBump] = useState(0); // 项目列表变化时 bump

  // === v1.5:provider 是单例 ClientProvider,所有调用走 /api/llm/chat
  const providerRef = useRef<LLMProvider>(new ClientProvider());

  // === Project init ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await ensureCurrentProject();
      if (cancelled) return;
      setProjectId(id);
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

  // === 当前项目元数据(rootPath / brief)===
  const [currentRootPath, setCurrentRootPath] = useState<string | null>(null);
  useEffect(() => {
    if (projectId == null) return;
    let alive = true;
    (async () => {
      const p = await db.projects.get(projectId);
      const rp = await getProjectRoot(projectId);
      if (alive) {
        setProject(p ?? null);
        setCurrentRootPath(rp);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, projectsBump]);

  const controller = useMemo<ChatController | null>(() => {
    if (projectId == null || chatId == null) return null;
    return getChatController(projectId, chatId, () => providerRef.current);
  }, [projectId, chatId]);

  // Electron + native folder 项目:启动文件 watcher,外部改动自动刷预览
  useProjectWatcher(projectId);

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <ProjectsSidebar
        activeProjectId={projectId}
        activeChatId={chatId}
        onSelectProject={(id) => setProjectId(id)}
        onSelectChat={(id) => setChatId(id)}
        onProjectsChanged={() => setProjectsBump((v) => v + 1)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBrief={() => setBriefOpen(true)}
        onExport={async () => {
          await exportProjectAsZip(projectId, project?.name ?? 'project', {
            stripDevMarkers: stripExport,
          });
        }}
        stripExport={stripExport}
        toggleStripExport={() => setStripExport((v) => !v)}
      />

      {/* 中间 + 右:用一个 flex column 包,让顶部 slim header 跨越中右两栏 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <ProjectHeader
          project={project}
          projectId={projectId}
          rootPath={currentRootPath}
        />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          <FileTreeColumn
            projectId={projectId}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
          />
          <MidPane
            controller={controller}
            initialPath={
              selectedPath.endsWith('.html') || selectedPath === 'index.html'
                ? selectedPath
                : 'index.html'
            }
          />
          <ChatPane controller={controller} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      <ModelSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProjectBriefDialog
        projectId={projectId}
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
      />
    </div>
  );
}

function ProjectHeader({
  project,
  projectId,
  rootPath,
}: {
  project: Project | null;
  projectId: number;
  rootPath: string | null;
}) {
  return (
    <div
      style={{
        flex: '0 0 auto',
        height: 36,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 12,
        WebkitAppRegion: 'drag', // macOS hiddenInset 拖窗
      } as React.CSSProperties}
    >
      <div
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
        }}
      >
        {project?.name ?? '—'}
      </div>
      {rootPath && (
        <div
          style={{
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 360,
          }}
          title={rootPath}
        >
          {rootPath}
        </div>
      )}
      {!rootPath && (
        <div
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 11,
            fontStyle: 'italic',
          }}
          title="文件存在浏览器 IndexedDB,Electron 下可在新建对话框选本地文件夹"
        >
          (虚拟项目)
        </div>
      )}
      <span style={{ flex: 1 }} />
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <GitStatusBadge projectId={projectId} rootPath={rootPath} />
      </div>
    </div>
  );
}

function FileTreeColumn({
  projectId,
  selectedPath,
  onSelectPath,
}: {
  projectId: number;
  selectedPath: string;
  onSelectPath(p: string): void;
}) {
  return (
    <div
      style={{
        width: 200,
        flex: '0 0 200px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      <FileTree
        noFrame
        projectId={projectId}
        selectedPath={selectedPath}
        onSelect={onSelectPath}
      />
    </div>
  );
}
