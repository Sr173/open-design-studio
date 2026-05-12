/* 项目对应文件夹的 git 状态 — branch + 改动数。只读
 *
 * Electron + native 项目 + .git 目录存在时显示;否则隐藏
 */

import { useEffect, useState } from 'react';
import { native } from '../native';
import { onFileChange } from '../store/files';
import { onWatcherRefresh } from '../native/useProjectWatcher';

export function GitStatusBadge({
  projectId,
  rootPath,
}: {
  projectId: number;
  rootPath: string | null;
}) {
  const [info, setInfo] = useState<{
    branch: string;
    dirty: number;
  } | null>(null);

  useEffect(() => {
    if (!rootPath || !native()) {
      setInfo(null);
      return;
    }
    let alive = true;

    async function refresh() {
      const n = native();
      if (!n) return;
      const isRepo = await n.git.isRepo(rootPath!);
      if (!alive) return;
      if (!isRepo) {
        setInfo(null);
        return;
      }
      const gi = await n.git.info(rootPath!);
      if (!alive) return;
      if (!gi) {
        setInfo(null);
        return;
      }
      const dirty = gi.modified + gi.staged + gi.untracked + gi.deleted;
      setInfo({ branch: gi.branch, dirty });
    }

    refresh();
    // 文件变了重算 git status
    const unsub1 = onFileChange((e) => {
      if (e.projectId === projectId) refresh();
    });
    const unsub2 = onWatcherRefresh(refresh);
    return () => {
      alive = false;
      unsub1();
      unsub2();
    };
  }, [projectId, rootPath]);

  if (!info) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
      }}
      title={`branch: ${info.branch} · ${info.dirty} changed`}
    >
      <span style={{ color: 'var(--text-tertiary)' }}>⎇</span>
      <span>{info.branch}</span>
      {info.dirty > 0 && (
        <span style={{ color: 'var(--warning, #d97706)' }}>· {info.dirty} ✚</span>
      )}
    </span>
  );
}
