/* 代码级 detector — 不靠 prompt 自律,出问题直接拦截 tool 调用
 *
 * 跟 server/skill.md 里的 D1/D4/D10/D16 一一对应。
 * 命中后 executeTool 返回 is_error: true,LLM 拿到 tool_result 自己修正重试。
 *
 * D2/D3/D11/D12 涉及语义判断,留给 prompt 处理。
 */

import { listFiles } from '../store/files';
import { parse } from 'node-html-parser';

export interface LintResult {
  ok: true;
}
export interface LintFail {
  ok: false;
  reason: string;
}
export type LintCheck = LintResult | LintFail;

// === D1 — Aesthetic-first detector ===
// 在 ask_questions 工具调用前扫 questions 列表
// 若含美学关键词但无业务问题 → 拒
const AESTHETIC_WORDS = [
  'style', 'styles', '风格', '色调', '密度', 'vibe', 'feel', '气质',
  '参考哪个', '像哪个', '美学', 'aesthetic',
];
const BUSINESS_WORDS = [
  'usage frequency', '频率', '每天几次', '多少次',
  'top 3 actions', '最常做', '高频动作',
  '核心痛点', '痛点', 'pain', 'core pain',
  '是什么', '什么产品', '业务', '用户', '受众',
];

export function lintAskQuestions(args: {
  title: string;
  questions: Array<{ label?: string; hint?: string; type?: string; options?: any }>;
}): LintCheck {
  if (!Array.isArray(args.questions) || args.questions.length === 0) {
    return { ok: false, reason: '至少要 1 个 question' };
  }
  const all = (args.questions
    .map((q) => `${q.label ?? ''} ${q.hint ?? ''}`)
    .join(' ')).toLowerCase();
  const hasAesthetic = AESTHETIC_WORDS.some((w) => all.includes(w.toLowerCase()));
  const hasBusiness = BUSINESS_WORDS.some((w) => all.includes(w.toLowerCase()));
  if (hasAesthetic && !hasBusiness) {
    return {
      ok: false,
      reason:
        'D1 触发:问卷里全是美学题(style / 色调 / 密度 / 参考哪个 app)但没有任何业务题(用户、频率、痛点、top 3 actions)。' +
        '按 SKILL.md tier 顺序,业务题必须先,美学题必须最后。删掉/替换美学题为业务题再调一次。',
    };
  }
  return { ok: true };
}

// === D4 — Missing-shared detector(multi-variant only) ===
// 写 variants/<slug>/index.html 之前,必须先有 shared/(任意文件)
export async function lintWriteFile(
  projectId: number,
  path: string
): Promise<LintCheck> {
  const m = /^variants\/([^/]+)\/index\.html?$/i.exec(path);
  if (!m) return { ok: true };
  const files = await listFiles(projectId);
  const hasShared = files.some(
    (f) => f.path === 'shared/styles.css' || /^shared\//.test(f.path)
  );
  if (!hasShared) {
    return {
      ok: false,
      reason:
        `D4 触发:正在写 ${path} 但项目里没有 shared/styles.css(或任何 shared/* 文件)。` +
        `SKILL.md Phase 5 要求"shared 必须先于任何 variant"。` +
        `**先调一次 write_file shared/styles.css 把 palette / 字体 token / 公共 atoms 抽进去**,再开始写 variant。` +
        `不允许先写 variant 再"抽出" shared — 第一个 variant 会污染 shared。`,
    };
  }
  return { ok: true };
}

// === D10 — Missing variant commentary ===
// 扫**第一个 HTML 注释 / CSS 注释 / JS 块注释**的内容是否含 DNA/Fits/Tradeoff;
// 头 800 字符可能被 <head> 元数据吃掉,改成定位注释
export function lintVariantCommentary(
  path: string,
  content: string
): LintCheck {
  if (!/^variants\/[^/]+\/index\.html?$/i.test(path)) return { ok: true };

  // 找到前 3000 字符里所有的 HTML 注释 / 块注释,取最先出现的非空内容
  const head = content.slice(0, 3000);
  const commentBlocks: string[] = [];

  // HTML 注释 <!-- ... -->
  const htmlCommentRe = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = htmlCommentRe.exec(head))) {
    if (m[1].trim().length > 0) commentBlocks.push(m[1]);
  }
  // CSS / JS 块注释 /* ... */(可能写在 <style> / <script> 里)
  const blockCommentRe = /\/\*([\s\S]*?)\*\//g;
  while ((m = blockCommentRe.exec(head))) {
    if (m[1].trim().length > 0) commentBlocks.push(m[1]);
  }

  // 检查至少一个注释块同时含 DNA / Fits / Tradeoff
  const ok = commentBlocks.some(
    (c) =>
      /\bDNA\s*[:：]/i.test(c) &&
      /\bFits\s*[:：]/i.test(c) &&
      /\bTradeoff\s*[:：]/i.test(c)
  );

  if (!ok) {
    return {
      ok: false,
      reason:
        `D10 触发:variant 文件 ${path} 前 3000 字符没有任何注释块同时含 DNA / Fits / Tradeoff。` +
        `SKILL.md Artifact 7 要求文件开头一个块注释明确这三行(放在 <!DOCTYPE> 之前或 <head> / <style> / <script> 里都行)。` +
        `每行必须可证伪(具体用户 / 具体场景 / 具体牺牲),不能是"适合各类场景"这种空话。重写文件,在最顶部加注释。`,
    };
  }
  return { ok: true };
}

// === D16 — Generic variant labels ===
// 写 variant 时 slug 不能是 a/b/c/variant-1/editorial/minimal/bold
const BAD_SLUGS = new Set([
  'a', 'b', 'c', 'd', 'e',
  'variant-1', 'variant-2', 'variant-3', 'variant1', 'variant2', 'variant3',
  'one', 'two', 'three',
  'editorial', 'minimal', 'bold', 'modern', 'clean', 'simple',
  'dark', 'light', 'colorful',
]);

export function lintVariantSlug(path: string): LintCheck {
  const m = /^variants\/([^/]+)\/index\.html?$/i.exec(path);
  if (!m) return { ok: true };
  const slug = m[1].toLowerCase();
  if (BAD_SLUGS.has(slug)) {
    return {
      ok: false,
      reason:
        `D16 触发:variant slug "${slug}" 过于通用,无法暴露变化轴。` +
        `用 kebab-case 反映"轴上的取值",例:single-column-narrative / split-comparison / card-matrix / sidebar-led / topbar-flat。` +
        `读 slug 应该一眼看出三个变体在哪个维度变。换名重写。`,
    };
  }
  return { ok: true };
}

// === D12 — Variant proliferation ===
// 写 variants/<新 slug>/index.html 时,若已有 ≥4 个 variant 则拒绝
export async function lintVariantProliferation(
  projectId: number,
  path: string
): Promise<LintCheck> {
  const m = /^variants\/([^/]+)\/index\.html?$/i.exec(path);
  if (!m) return { ok: true };
  const newSlug = m[1];
  const files = await listFiles(projectId);
  const existing = new Set<string>();
  for (const f of files) {
    const mm = /^variants\/([^/]+)\/index\.html?$/i.exec(f.path);
    if (mm) existing.add(mm[1]);
  }
  // 如果新 slug 已存在 = 改既有 variant,放行
  if (existing.has(newSlug)) return { ok: true };
  if (existing.size >= 4) {
    return {
      ok: false,
      reason:
        `D12 触发:项目已有 ${existing.size} 个 variant(${[...existing].join(', ')}),` +
        `再加新 variant("${newSlug}")会进入变体疲劳区(>4 用户无法逐个评估)。` +
        `先决定淘汰哪个旧 variant(用户可在 chat 里选,然后调 delete_file 删掉那个 variant 目录),再写新的。` +
        `或者把这个差异做成现有 variant 里的 Tweak 控件。`,
    };
  }
  return { ok: true };
}

// === D11 — Equal-risk variants(质量梯度) ===
// 检查注释里是否暴露"保守/中位/大胆"梯度;没有则给警告(不阻塞,因为 prompt 里讲了)
// keep aligned with skill-core.md "Vocabulary the lint accepts" table — when you
// add a synonym here, also list it in core so the LLM knows it can use that word.
const CONSERVATIVE_HINTS = [
  // zh
  '保守', '克制', '贴现状', '常规', '默认', '稳妥', '低调', '基础', '锚定',
  // en
  'conservative', 'restrained', 'anchor', 'orthodox', 'default', 'safe',
  'minimal', 'stable', 'baseline', 'cautious',
];
const BOLD_HINTS = [
  // zh
  '大胆', '激进', '极端', '探索', '推到', '突破', '冒险', '冲击', '前卫',
  '实验', '激进派',
  // en
  'bold', 'aggressive', 'radical', 'exploratory', 'experimental',
  'pushed', 'extreme', 'daring', 'unconventional', 'adventurous',
];

export function lintRiskGradient(path: string, content: string): LintCheck {
  if (!/^variants\/[^/]+\/index\.html?$/i.test(path)) return { ok: true };
  // 这个 check 单文件无法验证(梯度是跨 3 个 variant 的关系)
  // 所以只在单文件层面给提示性 warning:文件里至少有一个梯度词
  const head = content.slice(0, 3000);
  const hasGradient =
    CONSERVATIVE_HINTS.some((w) => head.includes(w)) ||
    BOLD_HINTS.some((w) => head.includes(w));
  // 梯度词在 prompt 里教过,这里不强制 — 留给 prompt + 用户审阅判断
  // 不返回 fail,只是占位以后扩展
  void hasGradient;
  return { ok: true };
}

/** 跨 variant 梯度检查 — 在所有 variant 写完后跑一次(给 done 工具用) */
export async function lintRiskGradientAcrossVariants(
  projectId: number
): Promise<LintCheck> {
  const files = await listFiles(projectId);
  const variants = files.filter((f) =>
    /^variants\/[^/]+\/index\.html?$/i.test(f.path)
  );
  if (variants.length < 2) return { ok: true };

  // 统计每个 variant 是否含保守 / 大胆 关键词
  let conservativeCount = 0;
  let boldCount = 0;
  for (const v of variants) {
    const head = v.content.slice(0, 3000);
    if (CONSERVATIVE_HINTS.some((w) => head.includes(w))) conservativeCount++;
    if (BOLD_HINTS.some((w) => head.includes(w))) boldCount++;
  }
  if (conservativeCount === 0 && boldCount === 0) {
    return {
      ok: false,
      reason:
        `D11 警告:全部 ${variants.length} 个 variant 的注释里都没出现"保守 / 大胆 / 探索 / 克制"等梯度词。` +
        `SKILL.md 要求 A=保守 / B=中位 / C=大胆 的风险阶梯 —— 现在三个看起来都是"中位",用户只能按颜值挑。` +
        `调 read_skill("multi-variant") 看完整规则,然后重写每个 variant 的 DNA/Fits/Tradeoff 让梯度显式化。`,
    };
  }
  return { ok: true };
}
