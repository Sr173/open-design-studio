/* FileTree — 扁平文件列表,uploads/* 折叠到二级目录
 * 拖入文件:走 uploads.ts 入项目资源(不是 vision)
 */

import { useEffect, useState } from 'react';
import {
  listFiles,
  onFileChange,
  type WriteSource,
} from '../store/files';
import type { ProjectFile } from '../store/db';
import { uploadFileToProject } from '../attachments/uploads';

export function FileTree({
  projectId,
  onSelect,
  selectedPath,
  noFrame,
}: {
  projectId: number;
  onSelect?: (path: string) => void;
  selectedPath?: string;
  /** v1.6:嵌在外部容器(左栏 ChatList 下面)时不再渲染自己的宽度/边框 */
  noFrame?: boolean;
}) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await listFiles(projectId);
      if (!cancelled) setFiles(list);
    };
    refresh();
    const unsub = onFileChange((e) => {
      if (e.projectId === projectId) refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [projectId]);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const fs = Array.from(e.dataTransfer.files);
    for (const f of fs) {
      try {
        await uploadFileToProject(projectId, f);
      } catch (err) {
        console.warn('upload failed', err);
      }
    }
  }

  // 分组:uploads/ 单独
  const root = files.filter((f) => !f.path.startsWith('uploads/'));
  const uploads = files.filter((f) => f.path.startsWith('uploads/'));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={
        noFrame
          ? {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
              minHeight: 0,
            }
          : {
              width: 'var(--filetree-w)',
              flex: '0 0 var(--filetree-w)',
              background: 'var(--bg-panel)',
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
            }
      }
    >
      <div
        style={{
          padding: 'var(--sp-3)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        files
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--sp-2)',
        }}
      >
        {files.length === 0 && (
          <div
            style={{
              padding: 'var(--sp-3)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            (空)拖图片到此处加入项目资源
          </div>
        )}
        {root.map((f) => (
          <FileItem
            key={f.id}
            file={f}
            selected={f.path === selectedPath}
            onClick={() => onSelect?.(f.path)}
          />
        ))}
        {uploads.length > 0 && (
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-tertiary)',
              padding: '8px 6px 4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            uploads/
          </div>
        )}
        {uploads.map((f) => (
          <FileItem
            key={f.id}
            file={f}
            selected={f.path === selectedPath}
            onClick={() => onSelect?.(f.path)}
            indent
          />
        ))}
      </div>

      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 6,
            border: '2px dashed var(--accent)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 164, 81, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            fontSize: 'var(--fs-sm)',
            pointerEvents: 'none',
          }}
        >
          📁 加入项目
        </div>
      )}
    </div>
  );
}

function FileItem({
  file,
  selected,
  onClick,
  indent,
}: {
  file: ProjectFile;
  selected: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  const display = indent
    ? file.path.split('/').slice(1).join('/')
    : file.path;
  const writeSource: WriteSource | undefined = undefined; // 留口
  return (
    <div
      onClick={onClick}
      style={{
        padding: '4px 8px',
        paddingLeft: indent ? 18 : 8,
        fontSize: 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: selected ? 'var(--bg-elevated)' : 'transparent',
        borderRadius: 'var(--radius-xs)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={file.path}
    >
      {file.type === 'binary' && (
        <span style={{ color: 'var(--text-tertiary)', marginRight: 4 }}>
          ◇
        </span>
      )}
      {display}
      {writeSource && (
        <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
          {writeSource}
        </span>
      )}
    </div>
  );
}
