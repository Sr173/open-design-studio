/* 项目级钉板 — 哪些 message 被钉到 brief,新 chat 启动时注入 system 上下文
 *
 * 用法:用户看到 AI 输出 Checkpoint 块(commitment + variation axis)→ 点 📌 钉到项目
 * 之后任何在该项目下新建的 chat,LLM 都会先收到这些钉过的内容当 brief
 */

import { db, type ChatMessage } from './db';

export async function listPinnedIds(projectId: number): Promise<number[]> {
  const p = await db.projects.get(projectId);
  return p?.pinnedMessageIds ?? [];
}

export async function isPinned(
  projectId: number,
  messageId: number
): Promise<boolean> {
  const ids = await listPinnedIds(projectId);
  return ids.includes(messageId);
}

export async function togglePin(
  projectId: number,
  messageId: number
): Promise<boolean> {
  const ids = await listPinnedIds(projectId);
  const next = ids.includes(messageId)
    ? ids.filter((x) => x !== messageId)
    : [...ids, messageId];
  await db.projects.update(projectId, {
    pinnedMessageIds: next,
    updatedAt: Date.now(),
  });
  return next.includes(messageId);
}

/** 拉取所有钉过的 message 完整内容(给 ChatController 注入用) */
export async function loadPinnedMessages(
  projectId: number
): Promise<ChatMessage[]> {
  const ids = await listPinnedIds(projectId);
  if (ids.length === 0) return [];
  const out: ChatMessage[] = [];
  for (const id of ids) {
    const m = await db.messages.get(id);
    if (m) out.push(m);
  }
  // 按 createdAt 排序保留原有逻辑顺序
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

const listeners = new Set<(projectId: number) => void>();
export function onPinnedChange(fn: (projectId: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitPinnedChange(projectId: number): void {
  for (const fn of listeners) fn(projectId);
}
