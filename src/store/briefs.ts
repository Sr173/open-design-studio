/* 项目 brief + 任务 brief 类型 + 拼装为 LLM prompt 文本
 *
 * 两层结构:
 *   ProjectBrief = 跨任务共享的产品背景(填一次)
 *   TaskBrief    = 每次新建任务时填的本任务目标
 *
 * AI 每次调用,buildProviderMessages 把这两层 + 钉板内容拼成 user message 注入到首位
 */

export interface ProjectBrief {
  /** 一句话产品描述 */
  product?: string;
  /** 主要用户(chip) */
  audience?: string;
  /** 用户高频动作 top 3(自由文本,逗号或换行分隔) */
  topActions?: string;
  /** 想像哪些产品(reference anchors) */
  likeAnchors?: string[];
  /** 不想像哪些产品(avoid) */
  avoidAnchors?: string[];
  /** 必带约束(chip 多选) */
  constraints?: string[];
  /** 品牌资产说明(自由文本,如 logo / 色板) */
  brandAssets?: string;
}

export type TaskKind =
  | 'new_page'
  | 'redesign'
  | 'local_component'
  | 'copy_tweak'
  | 'tweak_value';

export interface TaskBrief {
  /** 任务类型 */
  kind?: TaskKind;
  /** 任务目标(必填,一句话) */
  goal: string;
  /** 范围:改哪些 / 不动哪些 */
  scope?: string;
  /** 风险偏好 */
  risk?: 'conservative' | 'balanced' | 'exploratory';
}

const TASK_KIND_LABEL: Record<TaskKind, string> = {
  new_page: '新页设计',
  redesign: '重做现有页',
  local_component: '局部组件',
  copy_tweak: '文案微调',
  tweak_value: '调参 / Tweak',
};

const RISK_LABEL: Record<NonNullable<TaskBrief['risk']>, string> = {
  conservative: '保守(贴现状)',
  balanced: '平衡(默认)',
  exploratory: '探索(可冒险)',
};

export function isProjectBriefEmpty(b: ProjectBrief | null | undefined): boolean {
  if (!b) return true;
  return (
    !b.product &&
    !b.audience &&
    !b.topActions &&
    (!b.likeAnchors || b.likeAnchors.length === 0) &&
    (!b.avoidAnchors || b.avoidAnchors.length === 0) &&
    (!b.constraints || b.constraints.length === 0) &&
    !b.brandAssets
  );
}

export function formatProjectBrief(b: ProjectBrief | null | undefined): string {
  if (!b || isProjectBriefEmpty(b)) return '';
  const lines: string[] = ['[项目级背景 — 跨任务共享]'];
  if (b.product) lines.push(`- 产品: ${b.product}`);
  if (b.audience) lines.push(`- 主要用户: ${b.audience}`);
  if (b.topActions) lines.push(`- 用户 top 3 动作: ${b.topActions}`);
  if (b.likeAnchors && b.likeAnchors.length > 0)
    lines.push(`- 像谁: ${b.likeAnchors.join('、')}`);
  if (b.avoidAnchors && b.avoidAnchors.length > 0)
    lines.push(`- 不像谁: ${b.avoidAnchors.join('、')}`);
  if (b.constraints && b.constraints.length > 0)
    lines.push(`- 约束: ${b.constraints.join('、')}`);
  if (b.brandAssets) lines.push(`- 品牌资产: ${b.brandAssets}`);
  return lines.join('\n');
}

export function formatTaskBrief(b: TaskBrief | null | undefined): string {
  if (!b || !b.goal) return '';
  const lines: string[] = ['[本任务背景]'];
  if (b.kind) lines.push(`- 类型: ${TASK_KIND_LABEL[b.kind]}`);
  lines.push(`- 目标: ${b.goal}`);
  if (b.scope) lines.push(`- 范围: ${b.scope}`);
  if (b.risk) lines.push(`- 风险偏好: ${RISK_LABEL[b.risk]}`);
  return lines.join('\n');
}

export const TASK_KIND_OPTIONS: Array<{ value: TaskKind; label: string }> = [
  { value: 'new_page', label: TASK_KIND_LABEL.new_page },
  { value: 'redesign', label: TASK_KIND_LABEL.redesign },
  { value: 'local_component', label: TASK_KIND_LABEL.local_component },
  { value: 'copy_tweak', label: TASK_KIND_LABEL.copy_tweak },
  { value: 'tweak_value', label: TASK_KIND_LABEL.tweak_value },
];

export const RISK_OPTIONS: Array<{ value: NonNullable<TaskBrief['risk']>; label: string }> = [
  { value: 'conservative', label: RISK_LABEL.conservative },
  { value: 'balanced', label: RISK_LABEL.balanced },
  { value: 'exploratory', label: RISK_LABEL.exploratory },
];

export const ANCHOR_PRESETS = [
  'Linear', 'Stripe', 'Notion', 'Figma', 'Apple', 'Vercel', 'Arc', 'Ramp',
  'Pinterest', 'Airbnb', 'Substack', 'Pitch',
];

export const CONSTRAINT_PRESETS = [
  '移动优先', 'PC 优先', '响应式',
  'SEO 友好', '可访问性 a11y', '国际化 i18n',
  '深色模式', '高对比', '极简文案', '内嵌品牌色',
];
