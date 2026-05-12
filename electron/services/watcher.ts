/* watcher — chokidar 监听项目根,事件推 IPC 给 renderer
 *
 * 防回声:AI 自己 write_file 后,fs 服务在内部短时间内屏蔽该 path 的 change 事件。
 * renderer 收到 fs:change 事件:① 触发预览刷新 ② push 到 userActionBuffer
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { WebContents } from 'electron';
import { designRoot } from './fs.js';

export type FsChangeEvent = {
  rootPath: string;
  relPath: string;
  kind: 'add' | 'change' | 'unlink';
  ts: number;
};

/** 一个 rootPath 一个 watcher 实例 */
const watchers = new Map<string, FSWatcher>();
/** 内部抑制集 — AI 刚写完的 path 在窗口期内忽略事件 */
const suppress = new Map<string, number>(); // key=`${root}::${relPath}`, value=expiry ms
const SUPPRESS_MS = 1500;

function shouldSuppress(rootPath: string, relPath: string): boolean {
  const key = `${rootPath}::${relPath}`;
  const exp = suppress.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    suppress.delete(key);
    return false;
  }
  return true;
}

/** 公开:AI 写文件前/后调,1.5s 内同 path 的 change 事件被丢弃 */
export function markAIWrite(rootPath: string, relPath: string) {
  suppress.set(`${rootPath}::${relPath}`, Date.now() + SUPPRESS_MS);
}

export function startWatcher(rootPath: string, webContents: WebContents): void {
  stopWatcher(rootPath);
  // v6.0g:只 watch <rootPath>/.design/ — 用户原项目代码改动跟我们无关
  const watchTarget = designRoot(rootPath);
  const w = chokidar.watch(watchTarget, {
    ignored: (filePath) => {
      const base = path.basename(filePath);
      return (
        base === '.DS_Store' ||
        /\.swp$/.test(base) // vim
      );
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });

  const emit = (kind: FsChangeEvent['kind'], abs: string) => {
    // rel 相对 .design/ — 跟 AI 视角一致
    const rel = path.relative(watchTarget, abs).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return;
    if (shouldSuppress(rootPath, rel)) return;
    const ev: FsChangeEvent = {
      rootPath,
      relPath: rel,
      kind,
      ts: Date.now(),
    };
    try {
      webContents.send('fs:change', ev);
    } catch {
      // window 可能已经关
    }
  };

  w.on('add', (p) => emit('add', p));
  w.on('change', (p) => emit('change', p));
  w.on('unlink', (p) => emit('unlink', p));
  w.on('error', (err) => console.error('[watcher]', err));

  watchers.set(rootPath, w);
  console.log(`[watcher] started ${watchTarget}`);
}

export async function stopWatcher(rootPath: string): Promise<void> {
  const w = watchers.get(rootPath);
  if (!w) return;
  await w.close();
  watchers.delete(rootPath);
  console.log(`[watcher] stopped ${rootPath}`);
}

export async function stopAllWatchers(): Promise<void> {
  await Promise.all(Array.from(watchers.keys()).map((k) => stopWatcher(k)));
}
