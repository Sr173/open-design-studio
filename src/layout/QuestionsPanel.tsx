/* QuestionsPanel — AI 推上来的结构化问卷
 * 渲染 chip / 多选 / 滑块 / 文本 控件,提交后变 user message 触发新 turn
 *
 * 参考 design-work skill Phase 2 的 tier 顺序:业务 > 约束 > 美学
 * UI 设计参考给定截图(浅色卡片 + chip 圆角矩形)
 */

import { useMemo, useState } from 'react';
import type {
  QuestionSet,
  Question,
  QuestionAnswers,
  AnswerValue,
} from '../llm/questions';

export function QuestionsPanel({
  set,
  onSubmit,
  onCancel,
  disabled,
  streaming,
}: {
  set: QuestionSet;
  onSubmit: (answers: QuestionAnswers) => void;
  onCancel: () => void;
  disabled?: boolean;
  /** AI 还在 stream 出问题 — 提交按钮显示"等待 AI 完成" */
  streaming?: boolean;
}) {
  const initial = useMemo<QuestionAnswers>(() => {
    const a: QuestionAnswers = {};
    for (const q of set.questions) {
      if (q.type === 'slider') a[q.id] = { type: 'slider', value: q.default };
    }
    return a;
  }, [set]);
  const [answers, setAnswers] = useState<QuestionAnswers>(initial);

  function patch(id: string, v: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  }

  function skip(id: string) {
    setAnswers((prev) => ({ ...prev, [id]: { type: 'skipped' } }));
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#f4f1ec',
        color: '#1a1614',
        padding: '32px 48px 80px',
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 500,
          marginBottom: 8,
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
        }}
      >
        {set.title}
        {streaming && (
          <span
            style={{
              marginLeft: 12,
              fontSize: 13,
              color: '#a89580',
              fontWeight: 400,
              verticalAlign: 'middle',
            }}
          >
            <StreamingDot /> AI 正在挑问题…
          </span>
        )}
      </h1>
      <div
        style={{
          color: '#a89580',
          fontSize: 12,
          marginBottom: 28,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {set.questions.length} {set.questions.length === 1 ? 'question' : 'questions'}
        {streaming && ' · 仍在生成,等会再答'}
      </div>

      {set.questions.map((q, i) => (
        <FadeInWrap key={q.id} index={i}>
          <QuestionView
            question={q}
            value={answers[q.id]}
            onChange={(v) => patch(q.id, v)}
            onSkip={() => skip(q.id)}
          />
        </FadeInWrap>
      ))}

      {streaming && set.questions.length > 0 && (
        <div
          style={{
            padding: '16px 0',
            color: '#a89580',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          <StreamingDot /> AI 还在生成…
        </div>
      )}

      <div
        style={{
          marginTop: 32,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={onCancel}
          disabled={disabled || streaming}
          style={btnSecondary}
        >
          关闭
        </button>
        <button
          onClick={() => onSubmit(answers)}
          disabled={disabled || streaming}
          style={streaming ? { ...btnPrimary, opacity: 0.5, cursor: 'wait' } : btnPrimary}
          title={streaming ? '等 AI 把问题问完' : ''}
        >
          {streaming ? '⏳ 等待 AI 完成' : '提交答案 →'}
        </button>
      </div>
    </div>
  );
}

/** 简单的逐题淡入(纯 CSS,无第三方动画库)*/
function FadeInWrap({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <>
      <style>{`@keyframes aidQFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }`}</style>
      <div
        style={{
          animation: `aidQFadeIn 280ms ease-out both`,
          animationDelay: `${Math.min(index * 50, 300)}ms`,
        }}
      >
        {children}
      </div>
    </>
  );
}

function StreamingDot() {
  return (
    <>
      <style>{`@keyframes aidStreamDot {
        0%, 80%, 100% { opacity: 0.3; }
        40% { opacity: 1; }
      }`}</style>
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#d4a574',
          marginRight: 4,
          animation: 'aidStreamDot 1.4s ease-in-out infinite',
        }}
      />
    </>
  );
}

function QuestionView({
  question,
  value,
  onChange,
  onSkip,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  onSkip: () => void;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 4,
          color: '#1a1614',
        }}
      >
        {question.label}
      </div>
      {question.hint && (
        <div
          style={{
            fontSize: 13,
            color: '#888180',
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          {question.hint}
        </div>
      )}
      {!question.hint && <div style={{ height: 12 }} />}

      <Control question={question} value={value} onChange={onChange} />

      {question.decideForMe && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={onSkip}
            style={{
              fontSize: 12,
              color: value?.type === 'skipped' ? '#1a1614' : '#888180',
              background: value?.type === 'skipped' ? '#e0d8c8' : 'transparent',
              padding: '4px 10px',
              borderRadius: 12,
              border: '1px solid rgba(0,0,0,0.12)',
            }}
            title={`AI 默认值:${question.decideForMe}`}
          >
            ✦ Decide for me
          </button>
        </div>
      )}
    </div>
  );
}

function Control({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  if (question.type === 'text') {
    const v = value?.type === 'text' ? value.value : '';
    if (question.multiline) {
      return (
        <textarea
          value={v}
          onChange={(e) => onChange({ type: 'text', value: e.target.value })}
          placeholder={question.placeholder ?? 'Your answer...'}
          rows={4}
          style={{ ...textInputStyle, resize: 'vertical' }}
        />
      );
    }
    return (
      <textarea
        value={v}
        onChange={(e) => onChange({ type: 'text', value: e.target.value })}
        placeholder={question.placeholder ?? 'Your answer...'}
        rows={3}
        style={{ ...textInputStyle, resize: 'vertical' }}
      />
    );
  }

  if (question.type === 'single') {
    const cur = value?.type === 'single' ? value.value : null;
    return (
      <ChipGroup
        options={question.options.map((o) => ({ ...o, selected: cur === o.value }))}
        allowOther={question.allowOther}
        otherSelected={
          cur != null && !question.options.some((o) => o.value === cur)
        }
        otherValue={
          cur != null && !question.options.some((o) => o.value === cur) ? cur : ''
        }
        onSelect={(v) => onChange({ type: 'single', value: v })}
        onOtherChange={(v) => onChange({ type: 'single', value: v })}
      />
    );
  }

  if (question.type === 'multi') {
    const cur = value?.type === 'multi' ? value.values : [];
    return (
      <ChipGroup
        multi
        options={question.options.map((o) => ({
          ...o,
          selected: cur.includes(o.value),
        }))}
        allowOther={question.allowOther}
        otherSelected={cur.some(
          (c) => !question.options.some((o) => o.value === c)
        )}
        otherValue={
          cur.find((c) => !question.options.some((o) => o.value === c)) ?? ''
        }
        onSelect={(v) => {
          const isCustom = !question.options.some((o) => o.value === v);
          if (isCustom) {
            const others = cur.filter((c) =>
              question.options.some((o) => o.value === c)
            );
            onChange({ type: 'multi', values: [...others, v] });
            return;
          }
          const next = cur.includes(v)
            ? cur.filter((x) => x !== v)
            : [...cur, v];
          onChange({ type: 'multi', values: next });
        }}
        onOtherChange={(v) => {
          const others = cur.filter((c) =>
            question.options.some((o) => o.value === c)
          );
          onChange({ type: 'multi', values: v ? [...others, v] : others });
        }}
      />
    );
  }

  if (question.type === 'slider') {
    const v = value?.type === 'slider' ? value.value : question.default;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingTop: 4,
        }}
      >
        <span style={{ fontSize: 12, color: '#888180', minWidth: 14 }}>
          {question.min}
        </span>
        <input
          type="range"
          min={question.min}
          max={question.max}
          step={question.step ?? 1}
          value={v}
          onChange={(e) =>
            onChange({ type: 'slider', value: Number(e.target.value) })
          }
          style={{ flex: 1, accentColor: '#c97a30' }}
        />
        <span style={{ fontSize: 12, color: '#888180', minWidth: 14 }}>
          {question.max}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            minWidth: 28,
            textAlign: 'right',
            color: '#1a1614',
          }}
        >
          {v}
        </span>
      </div>
    );
  }

  return null;
}

function ChipGroup({
  options,
  multi,
  allowOther,
  otherSelected,
  otherValue,
  onSelect,
  onOtherChange,
}: {
  options: { label: string; value: string; selected: boolean; svg?: string }[];
  multi?: boolean;
  allowOther?: boolean;
  otherSelected?: boolean;
  otherValue?: string;
  onSelect: (v: string) => void;
  onOtherChange?: (v: string) => void;
}) {
  // 一组选项任一含 svg → 视觉网格(2 列 mini wireframe);否则 chip 行
  const hasSvg = options.some((o) => o.svg && o.svg.includes('<svg'));
  if (hasSvg) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {options.map((o) => (
          <SvgOption
            key={o.value}
            label={o.label}
            svg={o.svg ?? ''}
            selected={o.selected}
            onClick={() => onSelect(o.value)}
          />
        ))}
        {allowOther && (
          <div>
            <Chip selected={!!otherSelected} onClick={() => {}}>Other</Chip>
            <input
              type="text"
              placeholder="Other..."
              value={otherValue ?? ''}
              onChange={(e) => onOtherChange?.(e.target.value)}
              style={{
                marginTop: 6,
                padding: '6px 10px',
                width: '100%',
                borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.12)',
                background: 'transparent',
                fontSize: 13,
                color: '#1a1614',
              }}
            />
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {options.map((o) => (
        <Chip key={o.value} selected={o.selected} onClick={() => onSelect(o.value)}>
          {o.label}
        </Chip>
      ))}
      {allowOther && (
        <>
          <Chip selected={!!otherSelected} onClick={() => {}}>
            Other
          </Chip>
          <input
            type="text"
            placeholder="Other..."
            value={otherValue ?? ''}
            onChange={(e) => onOtherChange?.(e.target.value)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid rgba(0,0,0,0.12)',
              background: 'transparent',
              fontSize: 13,
              color: '#1a1614',
              minWidth: 120,
            }}
          />
        </>
      )}
    </div>
  );
}

function Chip({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 16px',
        borderRadius: 999,
        border: selected ? '1px solid #1a1614' : '1px solid rgba(0,0,0,0.12)',
        background: selected ? '#1a1614' : 'transparent',
        color: selected ? '#f4f1ec' : '#1a1614',
        fontSize: 13,
        fontWeight: selected ? 500 : 400,
        cursor: 'pointer',
        transition: 'all 80ms',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff',
  fontSize: 14,
  color: '#1a1614',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 6,
  background: '#1a1614',
  color: '#f4f1ec',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  background: 'transparent',
  color: '#1a1614',
  border: '1px solid rgba(0,0,0,0.12)',
  fontSize: 13,
};

function SvgOption({
  label, svg, selected, onClick,
}: { label: string; svg: string; selected: boolean; onClick(): void }) {
  // 安全:strip <script>;LLM 应不发但保险
  const safeSvg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 8,
        background: selected ? 'rgba(255,164,81,0.14)' : 'transparent',
        border: selected ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.12)',
        cursor: 'pointer',
        textAlign: 'center',
        color: '#1a1614',
      }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '80 / 56',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        // SVG 已经 strip script;来源是服务端 system prompt 控制的 AI 输出
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
      <span style={{ fontSize: 12, fontWeight: selected ? 600 : 400 }}>{label}</span>
    </button>
  );
}
