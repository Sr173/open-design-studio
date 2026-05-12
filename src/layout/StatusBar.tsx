/* StatusBar — 底部 22px,VSCode 风
 *
 *  [⎇ main · 3 staged · 0 conflicts]  [turn 04 · 7.2s · latency 920ms · ctx 12k]
 *  [errors 0 · warn 0 · ● claude-opus-4-7]  [file ln · utf-8]
 *  [spacer]
 *  [▶ preview · zoom 100% · vp 1280×800 · ⌘K]
 *
 * 数据源:
 *   - git: native git service(Electron only)
 *   - chat runtime: ChatController state
 *   - 当前 file: 父组件传入(选中的预览 path)
 *   - mode: PreviewPane bridge
 */

import { useEffect, useState } from 'react';
import type { ChatController } from '../store/chat';
import { native } from '../native';
import type { GitInfo } from '../native';
import { onFileChange } from '../store/files';

export interface StatusBarProps {
  controller: ChatController;
  rootPath: string | null;
  selectedPath: string;
  mode: 'preview' | 'inspect' | 'comment' | 'edit';
  viewportLabel: string; // "1280×800"
  zoomPercent: number;
  errorCount: number;
  modelName: string;
  modelConnected: boolean;
  onOpenCmdPalette(): void;
}

export function StatusBar({
  controller,
  rootPath,
  selectedPath,
  mode,
  viewportLabel,
  zoomPercent,
  errorCount,
  modelName,
  modelConnected,
  onOpenCmdPalette,
}: StatusBarProps) {
  const git = useGitInfo(rootPath, controller.projectId);
  const meta = useRuntimeMeta(controller);

  return (
    <div className="wb-statusbar">
      {/* === group 1: git === */}
      {git ? (
        <div className="wb-sb-grp">
          <button className="wb-sb" title="git branch">
            <span>⎇</span>
            <b>{git.branch}</b>
          </button>
          <button
            className="wb-sb"
            title={`staged ${git.staged} · modified ${git.modified} · untracked ${git.untracked} · deleted ${git.deleted}`}
          >
            <span className={git.staged + git.modified > 0 ? 'warn' : 'ok'}>●</span>
            <span className="lbl">stg</span>
            <b>{git.staged}</b>
            <span className="lbl" style={{ marginLeft: 6 }}>mod</span>
            <b>{git.modified}</b>
          </button>
          <button className="wb-sb" title="branch ahead/behind">
            <span className="lbl">↑</span>
            <b>{git.ahead}</b>
            <span className="lbl">↓</span>
            <b>{git.behind}</b>
          </button>
        </div>
      ) : (
        <div className="wb-sb-grp">
          <button className="wb-sb" title="项目未绑定 git 仓库">
            <span className="lbl">no git</span>
          </button>
        </div>
      )}

      {/* === group 2: runtime === */}
      <div className="wb-sb-grp">
        <button className="wb-sb" title={`本 chat 第 ${meta.turnCount} 个 turn`}>
          <span className="lbl">turn</span>
          <b>{String(meta.turnCount).padStart(2, '0')}</b>
          {meta.running && (
            <>
              <span className="lbl" style={{ marginLeft: 6 }}>·</span>
              <span className="acc">running</span>
            </>
          )}
        </button>
        <button className="wb-sb" title={`context ~${meta.tokensUsed.toLocaleString()} tokens`}>
          <span className="lbl">ctx</span>
          <b>{formatK(meta.tokensUsed)}</b>
          <span className="lbl">/200k</span>
        </button>
      </div>

      {/* === group 3: signals === */}
      <div className="wb-sb-grp">
        <button className="wb-sb" title={`${errorCount} console error(s)`}>
          <span className="lbl">err</span>
          <span className={errorCount > 0 ? 'err' : 'ok'}>{errorCount}</span>
        </button>
        <button className="wb-sb" title={`LLM ${modelConnected ? 'connected' : 'disconnected'} · ${modelName}`}>
          <span className={modelConnected ? 'wb-dot ok' : 'wb-dot err'} />
          <span style={{ color: 'var(--text-secondary)' }}>{modelName}</span>
        </button>
      </div>

      {/* === group 4: current file === */}
      {selectedPath && (
        <div className="wb-sb-grp">
          <button className="wb-sb" title={`当前打开 .design/${selectedPath}`}>
            <span className="lbl">file</span>
            <b>{selectedPath}</b>
          </button>
        </div>
      )}

      <div className="wb-sb-spacer" />

      {/* === right group: mode / zoom / vp / ⌘K === */}
      <div className="wb-sb-grp">
        <button className="wb-sb" title="当前 mode · 数字键 1-4 切换">
          <span className="acc">{modeIcon(mode)} {mode}</span>
        </button>
        <button className="wb-sb">
          <span className="lbl">zoom</span>
          <b>{zoomPercent}<span className="lbl">%</span></b>
        </button>
        <button className="wb-sb">
          <span className="lbl">vp</span>
          <b>{viewportLabel}</b>
        </button>
        <button className="wb-sb" onClick={onOpenCmdPalette} title="⌘K 打开命令面板">
          <span className="lbl">cmd</span>
          <span className="wb-kbd sm">⌘K</span>
        </button>
      </div>
    </div>
  );
}

function modeIcon(m: string): string {
  return m === 'preview' ? '▶' : m === 'inspect' ? '⊙' : m === 'comment' ? '💬' : '✎';
}

function formatK(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// ============================================================
// useGitInfo — 每 5s 刷一次,或者文件变化时刷
// ============================================================
function useGitInfo(rootPath: string | null, projectId: number): GitInfo | null {
  const [info, setInfo] = useState<GitInfo | null>(null);
  useEffect(() => {
    if (!rootPath || !native()) {
      setInfo(null);
      return;
    }
    let alive = true;
    async function refresh() {
      const n = native();
      if (!n || !rootPath) return;
      const gi = await n.git.info(rootPath).catch(() => null);
      if (alive) setInfo(gi);
    }
    refresh();
    const t = setInterval(refresh, 5000);
    const unsub = onFileChange((e) => {
      if (e.projectId === projectId) refresh();
    });
    return () => {
      alive = false;
      clearInterval(t);
      unsub();
    };
  }, [rootPath, projectId]);
  return info;
}

// ============================================================
// useRuntimeMeta — 监听 ChatController + 数 messages
// ============================================================
function useRuntimeMeta(controller: ChatController) {
  const [meta, setMeta] = useState({
    turnCount: 0,
    tokensUsed: 0,
    running: false,
  });
  useEffect(() => {
    const unsubState = controller.subscribe((s) => {
      setMeta((prev) => ({ ...prev, running: s.running }));
    });
    return () => {
      unsubState();
    };
  }, [controller]);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const messages = await (await import('../store/db')).db.messages
        .where({ chatId: controller.chatId })
        .toArray()
        .catch(() => []);
      if (!alive) return;
      const userMsgs = messages.filter((m) => m.role === 'user').length;
      let chars = 0;
      for (const m of messages) {
        for (const b of m.blocks ?? []) {
          if (b.type === 'text') chars += b.text.length;
          else if (b.type === 'tool_result')
            chars +=
              typeof b.content === 'string'
                ? b.content.length
                : JSON.stringify(b.content).length;
          else if (b.type === 'tool_use') chars += JSON.stringify(b.input).length;
        }
      }
      setMeta((prev) => ({
        ...prev,
        turnCount: userMsgs,
        tokensUsed: Math.round(chars / 4),
      }));
    }
    refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [controller.chatId]);

  return meta;
}
