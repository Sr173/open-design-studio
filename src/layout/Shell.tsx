/* Shell v6.2 — workbench 三栏左右布局(sidebar-companion 风)
 *
 *  ┌─ TopBar (36) ────────────────────────────────────────────────┐
 *  ├──┬───────────────────────────────────────┬───────────────────┤
 *  │  │  center-toolbar (mode tabs / vp / ...)│                   │
 *  │Rl│                                       │                   │
 *  │56│       canvas-frame                    │   ChatPane 340    │
 *  │  │       (PreviewPane)                   │   固定右栏        │
 *  │  ├───────────────────────────────────────┤                   │
 *  │  │  VariantBar (48)                      │                   │
 *  ├──┴───────────────────────────────────────┴───────────────────┤
 *  │  StatusBar (22)                                                │
 *  └────────────────────────────────────────────────────────────────┘
 *
 *  - Rail 56px:icons + flyout(项目 / 文件 / 搜索 / Tweak / 附件 / 设置)
 *  - ChatPane 340px 固定右栏(不浮动,不可拖)
 *  - VariantBar 48px 画布底部(横向 chips,A·B·C + size + mtime + 回滚提示)
 *  - PreviewPane 自带 mode 切换 + viewport 等
 *  - ⌘K CmdPalette 仍可用,作为快速跳转 / 命令
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { MidPane } from './MidPane';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { CmdPalette } from './CmdPalette';
import { RailSidebar } from './RailSidebar';
import { VariantBar } from './VariantBar';
import { ChatPane } from './ChatPane';
import { ModelSettings } from '../settings/ModelSettings';
import { exportProjectAsZip } from '../settings/exportProject';
import { ProjectBriefDialog } from './ProjectBriefDialog';
import { NewProjectDialog } from './NewProjectDialog';
import {
  type ChatController,
  getChatController,
} from '../store/chat';
import { ClientProvider, fetchServerConfig } from '../llm/clientProvider';
import type { LLMProvider } from '../llm/provider';
import {
  ensureCurrentProject,
  createProject,
} from '../store/projects';
import { ensureCurrentChat } from '../store/chats';
import type { Project } from '../store/db';
import { db } from '../store/db';
import { getProjectRoot, listFiles } from '../store/files';
import { useProjectWatcher } from '../native/useProjectWatcher';
import { getElementBridge } from '../preview/elementBridge';
import { emitShow } from '../preview/showSignal';
import { detectVariants } from '../preview/variants';

export function Shell() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [stripExport, setStripExport] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>('index.html');
  const [bootDone, setBootDone] = useState(false);
  const [currentRootPath, setCurrentRootPath] = useState<string | null>(null);
  const [activeVariantSlug, setActiveVariantSlug] = useState<string | null>(null);

  const providerRef = useRef<LLMProvider>(new ClientProvider());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await ensureCurrentProject();
      if (cancelled) return;
      setProjectId(id);
      setBootDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [projectId]);

  useEffect(() => {
    if (projectId == null) return;
    let alive = true;
    listFiles(projectId).then((files) => {
      if (!alive) return;
      const vs = detectVariants(files);
      if (vs.length > 0 && !activeVariantSlug) {
        setActiveVariantSlug(vs[0].slug);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, activeVariantSlug]);

  const controller = useMemo<ChatController | null>(() => {
    if (projectId == null || chatId == null) return null;
    return getChatController(projectId, chatId, () => providerRef.current);
  }, [projectId, chatId]);

  useProjectWatcher(projectId);

  useEffect(() => {
    const onToggle = () => setCmdPaletteOpen((v) => !v);
    window.addEventListener('aid:cmdk-toggle', onToggle);
    return () => window.removeEventListener('aid:cmdk-toggle', onToggle);
  }, []);

  if (!bootDone) return <CenterLoader text="loading…" />;
  if (projectId == null) {
    return <OnboardingScreen onCreated={(id) => setProjectId(id)} />;
  }
  if (!controller) return <CenterLoader text="opening chat…" />;

  return (
    <ShellBody
      controller={controller}
      projectId={projectId}
      project={project}
      rootPath={currentRootPath}
      selectedPath={selectedPath}
      setSelectedPath={setSelectedPath}
      activeVariantSlug={activeVariantSlug}
      setActiveVariantSlug={setActiveVariantSlug}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      briefOpen={briefOpen}
      setBriefOpen={setBriefOpen}
      cmdPaletteOpen={cmdPaletteOpen}
      setCmdPaletteOpen={setCmdPaletteOpen}
      stripExport={stripExport}
      setStripExport={setStripExport}
      onSelectProject={setProjectId}
      onSelectChat={setChatId}
    />
  );
}

function ShellBody({
  controller,
  projectId,
  project,
  rootPath,
  selectedPath,
  setSelectedPath,
  activeVariantSlug,
  setActiveVariantSlug,
  settingsOpen,
  setSettingsOpen,
  briefOpen,
  setBriefOpen,
  cmdPaletteOpen,
  setCmdPaletteOpen,
  stripExport,
  setStripExport,
  onSelectProject,
  onSelectChat,
}: {
  controller: ChatController;
  projectId: number;
  project: Project | null;
  rootPath: string | null;
  selectedPath: string;
  setSelectedPath: (p: string) => void;
  activeVariantSlug: string | null;
  setActiveVariantSlug: (s: string | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  briefOpen: boolean;
  setBriefOpen: (v: boolean) => void;
  cmdPaletteOpen: boolean;
  setCmdPaletteOpen: (v: boolean) => void;
  stripExport: boolean;
  setStripExport: (v: boolean) => void;
  onSelectProject: (id: number) => void;
  onSelectChat: (id: number) => void;
}) {
  const bridge = useMemo(() => getElementBridge(projectId), [projectId]);
  const bridgeState = useSyncExternalStore(
    (cb) => bridge.subscribe(cb),
    () => bridge.getState()
  );

  const [modelCfg, setModelCfg] = useState<{ name: string; connected: boolean }>({
    name: '—',
    connected: false,
  });
  useEffect(() => {
    let alive = true;
    fetchServerConfig().then((c) => {
      if (!alive) return;
      setModelCfg({ name: c?.model ?? '—', connected: !!c?.hasKey });
    });
    return () => {
      alive = false;
    };
  }, [settingsOpen]);

  const commands = useMemo(
    () => [
      {
        id: 'open-settings',
        label: '打开模型设置',
        shortcut: '⌘,',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'open-brief',
        label: '编辑项目背景 brief',
        run: () => setBriefOpen(true),
      },
      {
        id: 'export-zip',
        label: stripExport
          ? '导出 .design/ 为 zip(清开发标记)'
          : '导出 .design/ 为 zip',
        run: async () => {
          await exportProjectAsZip(projectId, project?.name ?? 'project', {
            stripDevMarkers: stripExport,
          });
        },
      },
      {
        id: 'toggle-strip',
        label: stripExport ? '导出标记:已清理(关)' : '导出标记:保留(开"清理")',
        run: () => setStripExport(!stripExport),
      },
    ],
    [projectId, project, stripExport, setSettingsOpen, setBriefOpen, setStripExport]
  );

  const onSelectFileFromPalette = useCallback(
    (path: string) => {
      setSelectedPath(path);
      emitShow(projectId, path);
    },
    [projectId, setSelectedPath]
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        overflow: 'hidden',
        ['--chat-w' as any]: '340px',
      } as React.CSSProperties}
    >
      <TopBar
        project={project}
        controller={controller}
        selectedPath={selectedPath}
        rootPath={rootPath}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCmdPalette={() => setCmdPaletteOpen(true)}
      />

      {/* 三栏:rail | canvas (含 toolbar + frame + variant bar) | chat */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <RailSidebar
          activeProjectId={projectId}
          activeChatId={controller.chatId}
          onSelectProject={onSelectProject}
          onSelectChat={onSelectChat}
          onOpenCmdPalette={() => setCmdPaletteOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenBrief={() => setBriefOpen(true)}
          onExport={async () => {
            await exportProjectAsZip(projectId, project?.name ?? 'project', {
              stripDevMarkers: stripExport,
            });
          }}
        />

        {/* center column:canvas + bottom variant bar */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            background: 'var(--bg-base)',
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <MidPane
              controller={controller}
              initialPath={
                selectedPath.endsWith('.html') || selectedPath === 'index.html'
                  ? selectedPath
                  : 'index.html'
              }
            />
          </div>
          <VariantBar
            controller={controller}
            activeSlug={activeVariantSlug}
            onSelect={(slug) => {
              setActiveVariantSlug(slug);
              emitShow(projectId, `variants/${slug}/index.html`);
            }}
          />
        </div>

        {/* 固定右栏 chat */}
        <ChatPane controller={controller} onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      <StatusBar
        controller={controller}
        rootPath={rootPath}
        selectedPath={selectedPath}
        mode={bridgeState.mode}
        viewportLabel="1280×800"
        zoomPercent={100}
        errorCount={0}
        modelName={modelCfg.name}
        modelConnected={modelCfg.connected}
        onOpenCmdPalette={() => setCmdPaletteOpen(true)}
      />

      <CmdPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        projectId={projectId}
        rootPath={rootPath}
        onSelectFile={onSelectFileFromPalette}
        onSelectChat={(cid) => onSelectChat(cid)}
        onSelectProject={(pid) => onSelectProject(pid)}
        commands={commands}
      />

      <ModelSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProjectBriefDialog
        projectId={projectId}
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
      />
    </div>
  );
}

function CenterLoader({ text }: { text: string }) {
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
      {text}
    </div>
  );
}

function OnboardingScreen({ onCreated }: { onCreated(id: number): void }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
        padding: 32,
        background: 'var(--bg-base)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>
        Open Design Studio
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, maxWidth: 480 }}>
        AI 设计师工作台。每个项目挂到本地一个文件夹,AI 的设计产物落到该文件夹的{' '}
        <code style={{ color: 'var(--accent)' }}>.design/</code> 子目录,跟你原代码隔离。
      </div>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 20px',
          background: 'var(--accent)',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        ＋ 新建项目
      </button>
      <NewProjectDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreate={async ({ name, rootPath }) => {
          const id = await createProject(name, rootPath);
          onCreated(id);
        }}
      />
    </div>
  );
}
