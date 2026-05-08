/* Turn-level diff 快照 + 回滚
 *
 * 见 plan「回滚语义」节:
 *   - 回滚整 turn 范围(撤 AI + 用户该轮所有改动)
 *   - 第一次回滚弹 warning,可"下次不再提示"
 *   - 不做三方合并 (v1 out of scope)
 *
 * 实现:turn 开始前 startCapture() 拍当前文件快照,turn 结束 commitCapture() 算 diff
 */

import {
  db,
  type FileDiff,
  type FileType,
  type ProjectFile,
  type Snapshot,
} from './db';
import { listFiles, writeFile, deleteFile } from './files';

interface CaptureSession {
  projectId: number;
  turnId: string;
  beforeMap: Map<string, { type: FileType; content: string }>;
}

const active = new Map<string, CaptureSession>();   // turnId -> session

export async function startCapture(
  projectId: number,
  turnId: string
): Promise<void> {
  const files = await listFiles(projectId);
  const beforeMap = new Map<string, { type: FileType; content: string }>();
  for (const f of files) {
    beforeMap.set(f.path, { type: f.type, content: f.content });
  }
  active.set(turnId, { projectId, turnId, beforeMap });
}

export async function commitCapture(
  turnId: string,
  chatId?: number
): Promise<Snapshot | null> {
  const sess = active.get(turnId);
  if (!sess) return null;
  active.delete(turnId);

  const after = await listFiles(sess.projectId);
  const afterMap = new Map<string, ProjectFile>();
  for (const f of after) afterMap.set(f.path, f);

  const diff: FileDiff[] = [];
  // 找出修改 + 删除
  for (const [path, before] of sess.beforeMap) {
    const cur = afterMap.get(path);
    if (!cur) {
      diff.push({ path, before, after: null });   // 删除
    } else if (cur.content !== before.content || cur.type !== before.type) {
      diff.push({
        path,
        before,
        after: { type: cur.type, content: cur.content },
      });
    }
  }
  // 找出新建
  for (const [path, cur] of afterMap) {
    if (!sess.beforeMap.has(path)) {
      diff.push({
        path,
        before: null,
        after: { type: cur.type, content: cur.content },
      });
    }
  }

  if (diff.length === 0) return null;   // 没改动不存

  const id = await db.snapshots.add({
    projectId: sess.projectId,
    chatId,
    turnId: sess.turnId,
    diff,
    createdAt: Date.now(),
  });
  return (await db.snapshots.get(id as number))!;
}

/** 回滚:把所有 diff 反向应用 — before 写回去,新建的删掉 */
export async function rollback(snapshotId: number): Promise<void> {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap || snap.rolledBack) return;
  for (const d of snap.diff) {
    if (d.before == null) {
      // 这一 turn 是新建的 → 删掉
      await deleteFile(snap.projectId, d.path, 'system');
    } else {
      // 这一 turn 改/删了的 → 写回 before
      await writeFile(
        snap.projectId,
        d.path,
        d.before.content,
        d.before.type,
        'system'
      );
    }
  }
  await db.snapshots.update(snapshotId, { rolledBack: true });
}

export async function getSnapshotForTurn(
  projectId: number,
  turnId: string
): Promise<Snapshot | undefined> {
  return db.snapshots
    .where({ projectId, turnId })
    .filter((s) => !s.rolledBack)
    .first();
}

/** Settings 里读"是否已看过 rollback warning" */
export async function hasSeenRollbackWarning(): Promise<boolean> {
  const row = await db.settings.where('key').equals('rollbackWarningSeen').first();
  return row?.value === true;
}

export async function markRollbackWarningSeen(): Promise<void> {
  const existing = await db.settings.where('key').equals('rollbackWarningSeen').first();
  if (existing?.id != null) {
    await db.settings.update(existing.id, { value: true });
  } else {
    await db.settings.add({ key: 'rollbackWarningSeen', value: true });
  }
}
