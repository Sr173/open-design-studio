/* git 服务 — 只读 status / branch,**不**做 commit / push / merge
 *
 * simple-git 在仓库外路径会抛 GitError;catch 后返回 null。
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { statSync } from 'node:fs';
import path from 'node:path';

export interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  deleted: number;
}

export interface GitFileStatus {
  path: string;
  /** M = modified, A = added(staged new), D = deleted, ?? = untracked, R = renamed */
  status: 'M' | 'A' | 'D' | '??' | 'R' | '!';
}

function clientFor(rootPath: string): SimpleGit | null {
  try {
    const stat = statSync(path.join(rootPath, '.git'));
    if (!stat) return null;
  } catch {
    return null;
  }
  return simpleGit(rootPath);
}

export async function isRepo(rootPath: string): Promise<boolean> {
  return !!clientFor(rootPath);
}

export async function getInfo(rootPath: string): Promise<GitInfo | null> {
  const g = clientFor(rootPath);
  if (!g) return null;
  try {
    const status = await g.status();
    return {
      branch: status.current ?? 'detached',
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged.length,
      modified: status.modified.length,
      untracked: status.not_added.length,
      deleted: status.deleted.length,
    };
  } catch (e) {
    console.warn('[git] getInfo failed', e);
    return null;
  }
}

export async function getFileStatuses(rootPath: string): Promise<GitFileStatus[]> {
  const g = clientFor(rootPath);
  if (!g) return [];
  try {
    const status = await g.status();
    const out: GitFileStatus[] = [];
    for (const p of status.staged) out.push({ path: p, status: 'A' });
    for (const p of status.modified) out.push({ path: p, status: 'M' });
    for (const p of status.deleted) out.push({ path: p, status: 'D' });
    for (const p of status.not_added) out.push({ path: p, status: '??' });
    for (const r of status.renamed) out.push({ path: r.to, status: 'R' });
    return out;
  } catch (e) {
    console.warn('[git] getFileStatuses failed', e);
    return [];
  }
}
