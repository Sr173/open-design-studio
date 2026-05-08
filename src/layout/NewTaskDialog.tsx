/* 新建任务向导 — 替代裸的 + new chat
 * 用户填任务背景 → 创建 chat 并把 task brief 存进去
 * 提交后自动激活 + 发首条 user message 让 AI 直接进 build
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Field,
  ChipSingle,
  inputStyle,
  btnPrimary,
  btnSecondary,
} from '../components/Modal';
import {
  TASK_KIND_OPTIONS,
  RISK_OPTIONS,
  type TaskBrief,
  type TaskKind,
} from '../store/briefs';
import { createChat } from '../store/chats';
import { isProjectBriefEmpty } from '../store/briefs';
import { getProjectBrief } from '../store/projects';

export function NewTaskDialog({
  projectId,
  open,
  onClose,
  onCreated,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (chatId: number) => void;
}) {
  const [task, setTask] = useState<TaskBrief>({
    goal: '',
    kind: 'new_page',
    risk: 'balanced',
  });
  const [creating, setCreating] = useState(false);
  const [projectBriefMissing, setProjectBriefMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTask({ goal: '', kind: 'new_page', risk: 'balanced' });
    getProjectBrief(projectId).then((b) => {
      setProjectBriefMissing(isProjectBriefEmpty(b));
    });
  }, [open, projectId]);

  const canSubmit = task.goal.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const id = await createChat(projectId, undefined, task);
      onCreated(id);
      onClose();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建任务"
      footer={
        <>
          <button onClick={onClose} style={btnSecondary}>
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || creating}
            style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5 }}
          >
            {creating ? '创建中…' : '开始任务 →'}
          </button>
        </>
      }
    >
      {projectBriefMissing && (
        <div
          style={{
            padding: 'var(--sp-2) var(--sp-3)',
            background: 'rgba(255, 204, 102, 0.08)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--warning)',
            lineHeight: 1.6,
          }}
        >
          ⚠ 项目背景未填 — AI 每次都得猜产品 / 用户 / 风格。先去顶部 ⚙
          填项目背景,所有任务都会受益。
        </div>
      )}

      <Field
        label="任务目标"
        hint="一句话:想要什么 + 为什么。AI 直接基于这个动手"
        required
      >
        <textarea
          value={task.goal}
          onChange={(e) => setTask({ ...task, goal: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="例:重做登录页,让首次用户 30s 内完成注册"
          autoFocus
        />
      </Field>

      <Field label="任务类型">
        <ChipSingle<TaskKind>
          options={TASK_KIND_OPTIONS}
          value={task.kind}
          onChange={(v) => setTask({ ...task, kind: v })}
        />
      </Field>

      <Field
        label="范围"
        hint="哪些动 / 哪些不动 — 可选,但帮 AI 不越界"
      >
        <textarea
          value={task.scope ?? ''}
          onChange={(e) => setTask({ ...task, scope: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="例:只改 hero + CTA,导航和 footer 不动"
        />
      </Field>

      <Field
        label="风险偏好"
        hint="探索性任务可推到极端,保守任务贴现状"
      >
        <ChipSingle
          options={RISK_OPTIONS}
          value={task.risk}
          onChange={(v) => setTask({ ...task, risk: v })}
        />
      </Field>
    </Modal>
  );
}
