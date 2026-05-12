/* 项目 CRUD + 当前项目状态
 * 当前项目 ID 存 sessionStorage(关 tab 重选),不持久化跨 tab
 */

import { db, type Project } from './db';
import type { ProjectBrief } from './briefs';

const CURRENT_PROJECT_KEY = 'aid:currentProjectId';

export async function listProjects(): Promise<Project[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function createProject(
  name: string = '未命名项目',
  rootPath: string | null = null
): Promise<number> {
  const now = Date.now();
  const id = await db.projects.add({
    name,
    rootPath,
    createdAt: now,
    updatedAt: now,
  });
  setCurrentProjectId(id as number);
  return id as number;
}

/** 给已有项目绑定/解绑本地文件夹 */
export async function setProjectRoot(
  id: number,
  rootPath: string | null
): Promise<void> {
  await db.projects.update(id, { rootPath, updatedAt: Date.now() });
}

export async function renameProject(id: number, name: string): Promise<void> {
  await db.projects.update(id, { name, updatedAt: Date.now() });
}

export async function deleteProject(id: number): Promise<void> {
  await db.transaction(
    'rw',
    [db.projects, db.files, db.messages, db.snapshots],
    async () => {
      await db.files.where({ projectId: id }).delete();
      await db.messages.where({ projectId: id }).delete();
      await db.snapshots.where({ projectId: id }).delete();
      await db.projects.delete(id);
    }
  );
  if (getCurrentProjectId() === id) {
    sessionStorage.removeItem(CURRENT_PROJECT_KEY);
  }
}

export async function touchProject(id: number): Promise<void> {
  await db.projects.update(id, { updatedAt: Date.now() });
}

export async function getProjectBrief(id: number): Promise<ProjectBrief | null> {
  const p = await db.projects.get(id);
  return p?.brief ?? null;
}

export async function setProjectBrief(
  id: number,
  brief: ProjectBrief | null
): Promise<void> {
  await db.projects.update(id, { brief, updatedAt: Date.now() });
}

export function getCurrentProjectId(): number | null {
  const v = sessionStorage.getItem(CURRENT_PROJECT_KEY);
  return v ? Number(v) : null;
}

export function setCurrentProjectId(id: number): void {
  sessionStorage.setItem(CURRENT_PROJECT_KEY, String(id));
}

/** 启动时调用:确保有一个当前项目可用,没有就建一个空白的 */
export async function ensureCurrentProject(): Promise<number> {
  const cur = getCurrentProjectId();
  if (cur != null) {
    const exists = await db.projects.get(cur);
    if (exists) return cur;
  }
  // 取最近的或新建
  const recent = await db.projects.orderBy('updatedAt').reverse().first();
  if (recent?.id) {
    setCurrentProjectId(recent.id);
    return recent.id;
  }
  return createProject('未命名项目');
}
