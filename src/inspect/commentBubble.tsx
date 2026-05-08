/* 评论气泡 — 选中元素后浮现的输入框
 * 提交后 push 到 userActionBuffer
 */

import { useEffect, useRef, useState } from 'react';
import type { ElementInfo } from '../preview/sandboxBridge';

export function CommentBubble({
  target,
  onSubmit,
  onCancel,
}: {
  target: ElementInfo;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, [target.aid]);

  function submit() {
    if (!text.trim()) {
      onCancel();
      return;
    }
    onSubmit(text);
    setText('');
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 16,
        right: 16,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--sp-3)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 20,
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 6,
        }}
      >
        评论 #{target.aid} ({target.tag} "{target.textPreview}")
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="写一句对这个元素的反馈,Cmd/Ctrl+Enter 提交"
        rows={2}
        style={{
          width: '100%',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--sp-2)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-primary)',
          resize: 'vertical',
          marginBottom: 6,
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-xs)',
          }}
        >
          取消
        </button>
        <button
          onClick={submit}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: '#1a1410',
            fontSize: 'var(--fs-xs)',
            fontWeight: 600,
          }}
        >
          加入动作
        </button>
      </div>
    </div>
  );
}
