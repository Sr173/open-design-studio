/* 文件 CRUD — dispatcher
 *
 * 项目 rootPath:
 *   - null/undefined → IDB(浏览器虚拟项目,Electron 也兼容)
 *   - 字符串 → Electron 模式下的真实本地文件夹路径,走 window.aiDesignNative.fs
 *
 * 重要:files.write **不**触发预览刷新 — 刷新时机在 chat.ts(turn 结束 / done)
 *   或外部文件 watcher 推回来。这避免 streaming 期间预览闪烁
 */

import { db, type ProjectFile, type FileType, type Project } from './db';
import { native } from '../native';

export type WriteSource = 'ai' | 'user' | 'system';

export interface FileChangeEvent {
  projectId: number;
  path: string;
  source: WriteSource;
  prevContent: string | null;
  nextContent: string | null;
}

type Listener = (e: FileChangeEvent) => void;
const listeners = new Set<Listener>();
export function onFileChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(e: FileChangeEvent) {
  for (const fn of listeners) fn(e);
}

// 项目级 cache:projectId → rootPath。频繁读 IDB 太贵
const rootPathCache = new Map<number, string | null>();
async function getRootPath(projectId: number): Promise<string | null> {
  if (rootPathCache.has(projectId)) return rootPathCache.get(projectId) ?? null;
  const p = await db.projects.get(projectId);
  const rp = p?.rootPath ?? null;
  rootPathCache.set(projectId, rp);
  return rp;
}

/** 项目 rootPath 改变时(新建项目 / 解绑等)主动失效 */
export function invalidateRootPathCache(projectId: number) {
  rootPathCache.delete(projectId);
}

export async function listFiles(projectId: number): Promise<ProjectFile[]> {
  const rootPath = await getRootPath(projectId);
  if (rootPath && native()) {
    const items = await native()!.fs.list(rootPath);
    return items.map((it) => ({
      projectId,
      path: it.path,
      type: it.type,
      content: '', // 列表场景不带 content,需要时单独 readFile
      mtime: it.mtime,
    }));
  }
  return db.files.where({ projectId }).sortBy('path');
}

export async function readFile(
  projectId: number,
  path: string
): Promise<ProjectFile | undefined> {
  const rootPath = await getRootPath(projectId);
  if (rootPath && native()) {
    const f = await native()!.fs.read(rootPath, path);
    if (!f) return undefined;
    return {
      projectId,
      path: f.path,
      type: f.type,
      content: f.content,
      mtime: f.mtime,
    };
  }
  return db.files.where({ projectId, path }).first();
}

export async function writeFile(
  projectId: number,
  path: string,
  content: string,
  type: FileType = 'text',
  source: WriteSource = 'ai'
): Promise<void> {
  const rootPath = await getRootPath(projectId);
  let prev: string | null = null;

  if (rootPath && native()) {
    // 真实 fs:先读 prev(给 emit 用),再写
    const existing = await native()!.fs.read(rootPath, path).catch(() => null);
    prev = existing?.content ?? null;
    await native()!.fs.write(rootPath, path, content, type);
  } else {
    const existing = await db.files.where({ projectId, path }).first();
    prev = existing?.content ?? null;
    const now = Date.now();
    if (existing?.id != null) {
      await db.files.update(existing.id, { content, type, mtime: now });
    } else {
      await db.files.add({ projectId, path, content, type, mtime: now });
    }
  }
  emit({ projectId, path, source, prevContent: prev, nextContent: content });
}

export async function deleteFile(
  projectId: number,
  path: string,
  source: WriteSource = 'ai'
): Promise<void> {
  const rootPath = await getRootPath(projectId);
  let prev: string | null = null;

  if (rootPath && native()) {
    const existing = await native()!.fs.read(rootPath, path).catch(() => null);
    if (!existing) return;
    prev = existing.content;
    await native()!.fs.delete(rootPath, [path]);
  } else {
    const existing = await db.files.where({ projectId, path }).first();
    if (!existing?.id) return;
    prev = existing.content;
    await db.files.delete(existing.id);
  }
  emit({ projectId, path, source, prevContent: prev, nextContent: null });
}

export async function deleteFiles(
  projectId: number,
  paths: string[],
  source: WriteSource = 'ai'
): Promise<void> {
  for (const p of paths) await deleteFile(projectId, p, source);
}

/** 路径合法性校验:相对路径,无 .. 跳出,无前导 / */
export function isValidPath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (path.includes('\\')) return false;
  return true;
}

/** 给 read_file 工具用:超大文件按行截取 */
export function sliceContent(
  content: string,
  offset?: number,
  limit?: number
): string {
  if (offset == null && limit == null) return content;
  const lines = content.split('\n');
  const start = offset ?? 0;
  const end = limit != null ? start + limit : lines.length;
  return lines.slice(start, end).join('\n');
}

/** 用于 PreviewPane 等:拿到项目当前 rootPath(是否本地文件夹) */
export async function getProjectRoot(projectId: number): Promise<string | null> {
  return getRootPath(projectId);
}
