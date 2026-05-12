/* 项目文件 watcher — 仅 Electron + native project 模式生效
 *
 * 切换项目:start(newRoot) + stop(oldRoot)
 * 收到 fs:change:① 触发预览 refreshKey ② push 到 userActionBuffer 让 AI 知道
 */

import { useEffect } from 'react';
import { native } from './index';
import { db } from '../store/db';
import { pushAction } from '../store/userActionBuffer';
import { invalidateRootPathCache } from '../store/files';

export interface WatcherRefreshHandler {
  (): void;
}

let activeRoot: string | null = null;
let activeUnsubscribe: (() => void) | null = null;
const refreshHandlers = new Set<WatcherRefreshHandler>();

/** PreviewPane 等组件订阅"该刷新一次预览"信号 */
export function onWatcherRefresh(fn: WatcherRefreshHandler): () => void {
  refreshHandlers.add(fn);
  return () => refreshHandlers.delete(fn);
}
function emitRefresh() {
  for (const fn of refreshHandlers) fn();
}

export function useProjectWatcher(
  projectId: number | null
): void {
  useEffect(() => {
    if (projectId == null) return;
    if (!native()) return; // 浏览器版没 watcher
    let cancelled = false;

    (async () => {
      const proj = await db.projects.get(projectId);
      if (cancelled) return;
      const rootPath = proj?.rootPath ?? null;
      if (!rootPath) {
        // 切到一个非 native 项目 — 停掉旧的
        if (activeRoot) {
          await native()!.watcher.stop(activeRoot).catch(() => {});
          activeUnsubscribe?.();
          activeRoot = null;
          activeUnsubscribe = null;
        }
        return;
      }
      // 已经在 watch 同一个 root,跳过
      if (activeRoot === rootPath) return;
      // 切换
      if (activeRoot) {
        await native()!.watcher.stop(activeRoot).catch(() => {});
        activeUnsubscribe?.();
      }
      await native()!.watcher.start(rootPath);
      activeRoot = rootPath;
      activeUnsubscribe = native()!.watcher.onChange((ev) => {
        if (ev.rootPath !== rootPath) return;
        // 文件变了:刷一次缓存 + emit refresh + push 到 action buffer
        invalidateRootPathCache(projectId);
        emitRefresh();
        const verb = ev.kind === 'add' ? '新增' : ev.kind === 'unlink' ? '删除' : '修改';
        pushAction({
          kind: 'external_edit',
          path: ev.relPath,
          changeKind: ev.kind,
          note: `${verb} ${ev.relPath}`,
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);
}
