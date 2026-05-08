/* Chats — 项目内多个独立对话会话
 *
 * 模型(类比 Figma):
 *   Project (= 设计稿) ─┬─ Files[]    ← 共享真相
 *                       ├─ Chats[]    ← 多个独立 thread,每个自己的 turn 历史
 *                       └─ Pinned[]   ← 项目级 brief(注入新 chat)
 *
 * Chat 切换时,iframe 预览不变(因为预览是项目级的)。AI 跨 chat 看到的文件是同一份。
 */

import { db, type Chat } from './db';
import type { TaskBrief } from './briefs';

const CURRENT_CHAT_KEY_PREFIX = 'aid:currentChatId:';   // 后接 projectId

export async function listChats(projectId: number): Promise<Chat[]> {
  return db.chats.where({ projectId }).sortBy('updatedAt');
}

export async function createChat(
  projectId: number,
  name?: string,
  task?: TaskBrief | null
): Promise<number> {
  const now = Date.now();
  const existing = await listChats(projectId);
  const autoName =
    task?.goal?.slice(0, 24).trim() ?? `对话 ${existing.length + 1}`;
  const id = await db.chats.add({
    projectId,
    name: name ?? autoName,
    createdAt: now,
    updatedAt: now,
    task: task ?? null,
  });
  setCurrentChatId(projectId, id as number);
  return id as number;
}

export async function getChatTask(id: number): Promise<TaskBrief | null> {
  const c = await db.chats.get(id);
  return c?.task ?? null;
}

export async function setChatTask(
  id: number,
  task: TaskBrief | null
): Promise<void> {
  await db.chats.update(id, { task, updatedAt: Date.now() });
}

export async function renameChat(id: number, name: string): Promise<void> {
  await db.chats.update(id, { name, updatedAt: Date.now() });
}

export async function touchChat(id: number): Promise<void> {
  await db.chats.update(id, { updatedAt: Date.now() });
}

export async function deleteChat(id: number): Promise<void> {
  const chat = await db.chats.get(id);
  if (!chat) return;
  await db.transaction('rw', [db.chats, db.messages, db.snapshots], async () => {
    await db.messages.where({ chatId: id }).delete();
    // snapshots 关联的文件改动**保留**(项目级文件已经改了),只删 snapshot 记录
    // 这样未来用户还能在文件树看到改动结果,只是没法回滚
    await db.snapshots.where({ chatId: id }).delete();
    await db.chats.delete(id);
  });
  if (getCurrentChatId(chat.projectId) === id) {
    sessionStorage.removeItem(CURRENT_CHAT_KEY_PREFIX + chat.projectId);
  }
}

export function getCurrentChatId(projectId: number): number | null {
  const v = sessionStorage.getItem(CURRENT_CHAT_KEY_PREFIX + projectId);
  return v ? Number(v) : null;
}

export function setCurrentChatId(projectId: number, chatId: number): void {
  sessionStorage.setItem(CURRENT_CHAT_KEY_PREFIX + projectId, String(chatId));
}

/** 启动 / 切项目时调用:确保当前项目至少有一个 chat 且有"当前 chat" */
export async function ensureCurrentChat(projectId: number): Promise<number> {
  const cur = getCurrentChatId(projectId);
  if (cur != null) {
    const exists = await db.chats.get(cur);
    if (exists && exists.projectId === projectId) return cur;
  }
  const recent = await db.chats
    .where({ projectId })
    .reverse()
    .sortBy('updatedAt');
  if (recent.length > 0 && recent[0].id != null) {
    setCurrentChatId(projectId, recent[0].id);
    return recent[0].id;
  }
  return createChat(projectId, '主对话');
}
