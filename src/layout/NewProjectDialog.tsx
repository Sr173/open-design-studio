/* 新建项目对话框
 *
 * v6.0g 模型:每个项目必须绑一个真实本地文件夹,AI 产物落到 <root>/.design/
 *
 * 浏览器版无法选文件夹 — 显示提示让用户切到 Electron 桌面 App
 */

import { useState } from 'react';
import { native, isElectron } from '../native';

export interface NewProjectDialogProps {
  open: boolean;
  onClose(): void;
  onCreate(opts: { name: string; rootPath: string }): void;
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
      if (!name) {
        const base = p.split(/[/\\]/).filter(Boolean).pop() || '项目';
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

  function submit() {
    if (!pickedPath) return;
    const finalName = name.trim() || pickedPath.split(/[/\\]/).pop() || '未命名项目';
    onCreate({ name: finalName, rootPath: pickedPath });
    reset();
    onClose();
  }

  return (
    <div style={overlay} onClick={() => { reset(); onClose(); }}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-primary)' }}>
          新建项目
        </h3>

        {!electron && (
          <div
            style={{
              padding: 12,
              background: 'rgba(217, 119, 6, 0.1)',
              border: '1px solid rgba(217, 119, 6, 0.3)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            ⚠ 浏览器模式不能选本地文件夹。请用 <code>pnpm electron:dev</code>{' '}
            起桌面版,或直接打包 App 来用。
          </div>
        )}

        {electron && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              本地文件夹(必选)
            </div>
            {pickedPath ? (
              <div style={pickedBoxStyle}>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {pickedPath}
                </span>
                <button onClick={() => setPickedPath(null)} style={miniBtn}>
                  重选
                </button>
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
            <div
              style={{
                marginTop: 10,
                color: 'var(--text-tertiary)',
                fontSize: 11,
                lineHeight: 1.6,
                padding: '8px 10px',
                background: 'var(--bg-elevated)',
                borderRadius: 4,
              }}
            >
              · AI 生成的所有设计文件会放在{' '}
              <code style={{ color: 'var(--accent)' }}>{pickedPath ? `${pickedPath}/.design/` : '<选的文件夹>/.design/'}</code>
              <br />· 文件夹原有代码 ai-design 不会动,也读不到(隔离)
              <br />· 推荐挂到一个 git 仓库根 —— 顶栏会显示 branch + 改动数
              <br />· 可以把 <code>.design</code> 加进 <code>.gitignore</code>(或不加,作为 design assets 跟代码一起 version)
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              项目名(可选,默认用文件夹名)
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={pickedPath ? pickedPath.split(/[/\\]/).pop() : '项目名'}
                style={inputStyle}
              />
            </label>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button style={btnGhost} onClick={() => { reset(); onClose(); }}>
            取消
          </button>
          <button
            style={pickedPath ? btnPrimary : btnDisabled}
            disabled={!pickedPath}
            onClick={submit}
          >
            创建并绑定
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
  width: 540,
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
  padding: '10px 12px',
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
  padding: '8px 10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--text-primary)',
};
const miniBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  color: 'var(--text-tertiary)',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 3,
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
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--bg-elevated)',
  color: 'var(--text-disabled)',
  cursor: 'not-allowed',
};
