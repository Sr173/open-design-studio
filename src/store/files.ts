/* 文件 CRUD
 *
 * 重要:files.write **不**触发预览刷新 — 刷新时机在 chat.ts 里:
 *   ① done 工具调用时
 *   ② 整个 assistant turn 结束时
 *   ③ 用户单文件改动(Tweak / inline edit)— 由调用方显式触发
 *
 * 这避免 streaming 期间预览闪烁(plan「写入触发刷新」节)
 */

import { db, type ProjectFile, type FileType } from './db';

export type WriteSource = 'ai' | 'user' | 'system';

export interface FileChangeEvent {
  projectId: number;
  path: string;
  source: WriteSource;
  prevContent: string | null;   // null = 新建
  nextContent: string | null;   // null = 删除
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

export async function listFiles(projectId: number): Promise<ProjectFile[]> {
  return db.files.where({ projectId }).sortBy('path');
}

export async function readFile(
  projectId: number,
  path: string
): Promise<ProjectFile | undefined> {
  return db.files.where({ projectId, path }).first();
}

export async function writeFile(
  projectId: number,
  path: string,
  content: string,
  type: FileType = 'text',
  source: WriteSource = 'ai'
): Promise<void> {
  const existing = await readFile(projectId, path);
  const prev = existing?.content ?? null;
  const now = Date.now();
  if (existing?.id != null) {
    await db.files.update(existing.id, { content, type, mtime: now });
  } else {
    await db.files.add({ projectId, path, content, type, mtime: now });
  }
  emit({ projectId, path, source, prevContent: prev, nextContent: content });
}

export async function deleteFile(
  projectId: number,
  path: string,
  source: WriteSource = 'ai'
): Promise<void> {
  const existing = await readFile(projectId, path);
  if (!existing?.id) return;
  await db.files.delete(existing.id);
  emit({
    projectId,
    path,
    source,
    prevContent: existing.content,
    nextContent: null,
  });
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
