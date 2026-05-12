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
import { listFiles, readFile, writeFile, deleteFile, onFileChange } from './files';

interface CaptureSession {
  projectId: number;
  turnId: string;
  /** 仅记录被改过的 path → 第一次写入前的状态(null = 原本不存在) */
  beforeByPath: Map<string, { type: FileType; content: string } | null>;
  unsub: () => void;
}

const active = new Map<string, CaptureSession>();   // turnId -> session

export async function startCapture(
  projectId: number,
  turnId: string
): Promise<void> {
  // v1.8:不再 listFiles 全库 snapshot,改成监听 onFileChange 增量收集
  // 每个 path 第一次出现时记 prev(从 onFileChange.prevContent 拿),后续变化不覆盖
  const beforeByPath = new Map<
    string,
    { type: FileType; content: string } | null
  >();
  const unsub = onFileChange((e) => {
    if (e.projectId !== projectId) return;
    if (beforeByPath.has(e.path)) return;
    if (e.prevContent == null) {
      beforeByPath.set(e.path, null); // 新建
    } else {
      // 当前 file 的 type 在 writeFile 时确定;读 prev type 简化做法:
      // 假设 dirty 文件类型不会切(text/binary)。若需要可异步读取存档,但代价大。
      beforeByPath.set(e.path, { type: 'text', content: e.prevContent });
    }
  });
  active.set(turnId, { projectId, turnId, beforeByPath, unsub });
}

export async function commitCapture(
  turnId: string,
  chatId?: number
): Promise<Snapshot | null> {
  const sess = active.get(turnId);
  if (!sess) return null;
  active.delete(turnId);
  sess.unsub();

  if (sess.beforeByPath.size === 0) return null; // 没改动

  // 只对 dirty path 算 diff
  const diff: FileDiff[] = [];
  for (const [path, before] of sess.beforeByPath) {
    const cur = await readFile(sess.projectId, path);
    if (!cur) {
      // 当前不存在 — 这一 turn 是删除操作
      if (before) {
        diff.push({ path, before, after: null });
      }
      continue;
    }
    const afterEntry = { type: cur.type, content: cur.content };
    if (!before) {
      // 新建
      diff.push({ path, before: null, after: afterEntry });
    } else if (
      before.content !== cur.content ||
      before.type !== cur.type
    ) {
      diff.push({ path, before, after: afterEntry });
    }
  }

  if (diff.length === 0) return null;

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

/** 反向操作 — 把已经 rolledBack 的 snapshot 重新应用(redo) */
export async function redo(snapshotId: number): Promise<void> {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap || !snap.rolledBack) return;
  for (const d of snap.diff) {
    if (d.after == null) {
      // 原本是删除操作 → redo 仍删
      await deleteFile(snap.projectId, d.path, 'system');
    } else {
      await writeFile(
        snap.projectId,
        d.path,
        d.after.content,
        d.after.type,
        'system'
      );
    }
  }
  await db.snapshots.update(snapshotId, { rolledBack: false });
}

/** 生成 dry-run 预览数据 — 列出会被还原的文件 + 短 diff 摘要 */
export interface DryRunFileDiff {
  path: string;
  /** 该文件本轮发生了什么:created/modified/deleted */
  action: 'created' | 'modified' | 'deleted';
  /** 行数变化:before → after */
  beforeLines: number;
  afterLines: number;
}

export function getDryRun(snapshot: { diff: FileDiff[] }): DryRunFileDiff[] {
  return snapshot.diff.map((d) => {
    let action: DryRunFileDiff['action'];
    if (d.before == null) action = 'created';
    else if (d.after == null) action = 'deleted';
    else action = 'modified';
    const beforeLines = d.before?.content.split('\n').length ?? 0;
    const afterLines = d.after?.content.split('\n').length ?? 0;
    return { path: d.path, action, beforeLines, afterLines };
  });
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
