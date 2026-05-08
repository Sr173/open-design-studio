/* 结构化问答表单 — 让 AI 用 chip / slider / text 控件问问题,而不是 markdown 文字墙
 *
 * 设计原则(对齐 design-work skill 的 Phase 2):
 *   - 业务先于美学:default 顺序就是业务问题在前
 *   - 每题可选 "Decide for me" — AI 默认值兜底,不强制用户回答
 *   - 美学题鼓励用 chip 而不是 text(参考产品锚点 + 视觉示例 hits 直观)
 */

export type Question =
  | TextQuestion
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | SliderQuestion;

interface BaseQuestion {
  id: string;
  label: string;
  hint?: string;       // 副标题,解释为啥问
  /** 用户跳过此题时 AI 应使用的默认值;UI 显示为 "Decide for me" 按钮 */
  decideForMe?: string;
}

export interface TextQuestion extends BaseQuestion {
  type: 'text';
  placeholder?: string;
  multiline?: boolean;
}

export interface ChoiceOption {
  label: string;
  value: string;
}

export interface SingleChoiceQuestion extends BaseQuestion {
  type: 'single';
  options: ChoiceOption[];
  /** 是否允许填 "Other..." */
  allowOther?: boolean;
}

export interface MultiChoiceQuestion extends BaseQuestion {
  type: 'multi';
  options: ChoiceOption[];
  allowOther?: boolean;
}

export interface SliderQuestion extends BaseQuestion {
  type: 'slider';
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface QuestionSet {
  /** 由 AI 工具调用时传入 */
  title: string;
  questions: Question[];
  /** 客户端生成,关联回 tool_call */
  toolUseId?: string;
}

export type AnswerValue =
  | { type: 'text'; value: string }
  | { type: 'single'; value: string }
  | { type: 'multi'; values: string[] }
  | { type: 'slider'; value: number }
  | { type: 'skipped' };

export interface QuestionAnswers {
  [qid: string]: AnswerValue;
}

/** 把答案序列化成 user message text */
export function formatAnswers(set: QuestionSet, answers: QuestionAnswers): string {
  const lines: string[] = ['[问答回复]'];
  for (const q of set.questions) {
    const a = answers[q.id];
    if (!a || a.type === 'skipped') {
      const decide = (q as BaseQuestion).decideForMe;
      lines.push(`- ${q.label}: (用户让你定:${decide ?? '随你'})`);
      continue;
    }
    if (a.type === 'text' || a.type === 'single') {
      lines.push(`- ${q.label}: ${a.value}`);
    } else if (a.type === 'multi') {
      lines.push(`- ${q.label}: ${a.values.join('、')}`);
    } else if (a.type === 'slider') {
      lines.push(`- ${q.label}: ${a.value}`);
    }
  }
  return lines.join('\n');
}
