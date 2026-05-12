/* 新建项目对话框
 *
 *  浏览器版:只能建虚拟项目(IDB)
 *  Electron 版:两种选项 — 空白虚拟项目 / 选本地文件夹
 */

import { useState } from 'react';
import { native, isElectron } from '../native';

export interface NewProjectDialogProps {
  open: boolean;
  onClose(): void;
  onCreate(opts: { name: string; rootPath: string | null }): void;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const electron = isElectron();

  async function pickFolder() {
    setError(null);
    const n = native();
    if (!n) return;
    const p = await n.dialog.pickDirectory();
    if (!p) return;
    setValidating(true);
    try {
      await n.fs.validateRoot(p);
      setPickedPath(p);
      // 默认项目名 = 文件夹名
      if (!name) {
        const base = p.split(/[/\\]/).filter(Boolean).pop() || '未命名项目';
        setName(base);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPickedPath(null);
    } finally {
      setValidating(false);
    }
  }

  function reset() {
    setName('');
    setPickedPath(null);
    setError(null);
  }

  function submit(rootPath: string | null) {
    const finalName = name.trim() || (rootPath ? rootPath.split(/[/\\]/).pop() ?? '未命名项目' : '未命名项目');
    onCreate({ name: finalName, rootPath });
    reset();
    onClose();
  }

  return (
    <div style={overlay} onClick={() => { reset(); onClose(); }}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-primary)' }}>
          新建项目
        </h3>

        <label style={labelStyle}>
          名字(可选,留空自动生成)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="项目名"
            style={inputStyle}
          />
        </label>

        {electron && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              本地文件夹绑定(可选)
            </div>
            {pickedPath ? (
              <div style={pickedBoxStyle}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                  {pickedPath}
                </span>
                <button onClick={() => setPickedPath(null)} style={miniBtn}>清除</button>
              </div>
            ) : (
              <button onClick={pickFolder} disabled={validating} style={pickBtn}>
                {validating ? '验证中…' : '📁 选择本地文件夹'}
              </button>
            )}
            {error && (
              <div style={{ marginTop: 8, color: 'var(--error)', fontSize: 12 }}>
                {error}
              </div>
            )}
            <div style={{ marginTop: 8, color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
              {pickedPath
                ? 'AI 直接读写这个文件夹;关 App 文件保留;支持 VSCode 外部编辑同步'
                : '不选则创建虚拟项目(文件存浏览器 IndexedDB,关 App 仍在,但跟本地文件系统隔离)'}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button style={btnGhost} onClick={() => { reset(); onClose(); }}>取消</button>
          <button style={btnPrimary} onClick={() => submit(pickedPath)}>
            {pickedPath ? '创建并绑定' : '创建虚拟项目'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const panel: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: 20,
  width: 480,
  maxWidth: '90vw',
  fontSize: 13,
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '6px 8px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  fontSize: 13,
  color: 'var(--text-primary)',
};
const pickBtn: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--bg-input)',
  border: '1px dashed var(--border-default)',
  borderRadius: 4,
  color: 'var(--text-secondary)',
  fontSize: 13,
  cursor: 'pointer',
};
const pickedBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--text-primary)',
};
const miniBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  color: 'var(--text-tertiary)',
  background: 'transparent',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  fontSize: 12,
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px',
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
