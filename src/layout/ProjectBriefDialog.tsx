/* 项目背景表单 — 项目级 brief。填一次,所有任务共享。
 * 入口:Header 项目名旁 ⚙ 图标
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Field,
  ChipMulti,
  inputStyle,
  btnPrimary,
  btnSecondary,
} from '../components/Modal';
import {
  ANCHOR_PRESETS,
  CONSTRAINT_PRESETS,
  type ProjectBrief,
} from '../store/briefs';
import { getProjectBrief, setProjectBrief } from '../store/projects';

export function ProjectBriefDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [b, setB] = useState<ProjectBrief>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getProjectBrief(projectId).then((cur) => setB(cur ?? {}));
  }, [open, projectId]);

  async function handleSave() {
    setSaving(true);
    try {
      await setProjectBrief(projectId, b);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="项目背景 — 跨任务共享的产品上下文"
      footer={
        <>
          <button onClick={onClose} style={btnSecondary}>
            取消
          </button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <Field
        label="产品是什么"
        hint="一句话产品描述。例:给独立开发者用的轻量发票工具"
      >
        <input
          type="text"
          value={b.product ?? ''}
          onChange={(e) => setB({ ...b, product: e.target.value })}
          style={inputStyle}
          placeholder="一句话..."
        />
      </Field>

      <Field label="主要用户" hint="一句话谁用,什么场景">
        <input
          type="text"
          value={b.audience ?? ''}
          onChange={(e) => setB({ ...b, audience: e.target.value })}
          style={inputStyle}
          placeholder="例:初创团队的设计师 / 销售 / 工程师..."
        />
      </Field>

      <Field
        label="用户最常做的 3 件事"
        hint="决定页面优先级。逗号或换行分隔"
      >
        <textarea
          value={b.topActions ?? ''}
          onChange={(e) => setB({ ...b, topActions: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="发起对话、查看文件、导出..."
        />
      </Field>

      <Field
        label="想像谁(reference anchors)"
        hint="点击或输入参考产品。AI 用作美学锚点"
      >
        <ChipMulti
          options={ANCHOR_PRESETS}
          values={b.likeAnchors ?? []}
          onChange={(v) => setB({ ...b, likeAnchors: v })}
          allowOther
        />
      </Field>

      <Field label="不想像谁(avoid)" hint="哪些产品风格希望避开">
        <ChipMulti
          options={ANCHOR_PRESETS}
          values={b.avoidAnchors ?? []}
          onChange={(v) => setB({ ...b, avoidAnchors: v })}
          allowOther
        />
      </Field>

      <Field label="必带约束" hint="勾选所有适用的">
        <ChipMulti
          options={CONSTRAINT_PRESETS}
          values={b.constraints ?? []}
          onChange={(v) => setB({ ...b, constraints: v })}
          allowOther
        />
      </Field>

      <Field
        label="品牌资产 / 设计系统"
        hint="logo / 主色 / 字体 / 已有 token / 截图链接(自由文本)"
      >
        <textarea
          value={b.brandAssets ?? ''}
          onChange={(e) => setB({ ...b, brandAssets: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="主色 #ff8800,字体 Inter,logo 见 uploads/logo.png..."
        />
      </Field>
    </Modal>
  );
}
