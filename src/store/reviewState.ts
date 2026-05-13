/* Variant review state — persisted to .design/.review.json
 *
 * 3 状态:
 *   approved        🟢 user picked this one
 *   needs-changes   🟡 user wants modifications, not approving yet
 *   rejected        🔴 user discarded this variant
 *
 * 未设状态 = 默认 needs-review(implicit)
 *
 * 读写均通过 files.ts(走 IDB / native fs),AI 通过 read_file(".review.json") 可见。
 * 也会在 chat.ts 进 LLM 前自动注入 system context,确保 agent Phase 7 mode
 * 选择有 deterministic signal,不靠关键词识别。
 */

import { readFile, writeFile } from './files';

export type ReviewStatus = 'approved' | 'needs-changes' | 'rejected';

export interface ReviewState {
  /** schema 版本 */
  v: 1;
  variants: Record<string, ReviewStatus>;
  /** 最后更新 ms */
  updatedAt: number;
}

const REVIEW_PATH = '.review.json';

export async function readReviewState(projectId: number): Promise<ReviewState> {
  const f = await readFile(projectId, REVIEW_PATH).catch(() => null);
  if (!f || typeof f.content !== 'string') {
    return { v: 1, variants: {}, updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(f.content);
    if (parsed?.v === 1 && typeof parsed.variants === 'object') {
      return parsed as ReviewState;
    }
  } catch { /* fall through */ }
  return { v: 1, variants: {}, updatedAt: 0 };
}

export async function setReviewStatus(
  projectId: number,
  slug: string,
  status: ReviewStatus | null,
): Promise<void> {
  const state = await readReviewState(projectId);
  if (status === null) {
    delete state.variants[slug];
  } else {
    state.variants[slug] = status;
  }
  state.updatedAt = Date.now();
  await writeFile(projectId, REVIEW_PATH, JSON.stringify(state, null, 2), 'text', 'user');
}

/** 格式化为短小的 system context,供注入 LLM 用 */
export function formatReviewStateForContext(state: ReviewState): string {
  if (Object.keys(state.variants).length === 0) return '';
  const lines = Object.entries(state.variants).map(([slug, status]) => {
    const sym = status === 'approved' ? '🟢' : status === 'needs-changes' ? '🟡' : '🔴';
    return `${sym} ${slug}: ${status}`;
  });
  const hasApproved = Object.values(state.variants).some((s) => s === 'approved');
  let hint = '';
  if (hasApproved) {
    hint = '\n\n→ Variant lock active. Subsequent edits default to the approved variant\'s scope. Modifying shared/ requires explicit confirmation that it affects archived A/C.';
  }
  return `[Variant review state]\n${lines.join('\n')}${hint}`;
}
