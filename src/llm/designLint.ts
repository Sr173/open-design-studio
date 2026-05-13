/* design-lint — Cross-file deterministic lint runner.
 *
 * 跟 detectors.ts 的区别:
 *   detectors.ts 是 single-tool lint(call 前拦截、call 后单文件 check)
 *   designLint.ts 是 cross-file post-write scan:写完一批文件后,扫整个项目
 *   把所有违规以 lint 报告形式返给 LLM。LLM 看到就改,不依赖自觉。
 *
 * 触发时机:execWriteFile / execApplyPatch / execEditFile 写完之后,
 *           把 lint 结果挂在 tool_result.content 尾部。
 *
 * 检查项(每条都给 code/severity/path/msg):
 *   STANCE   — commitment Stance 行必含 `not`
 *   D10      — variant 文件头有 DNA/Fits/Tradeoff
 *   D11      — variant 注释含风险家族词(按 A/B/C 位置预期)
 *   D14/D12  — variants 数 ≤ 4
 *   D16      — variant slug 不在黑名单
 *   DATA-5   — shared/data.{js,ts} 必须含 5 个 DATA_STATES key
 *   SLOP     — AI-slop tells(Inter hero font / generic gradients / vague CTAs)
 *
 * 全部 warning 级别(不阻塞写入),但 LLM 一看到就改。
 */

import { listFiles, readFile } from '../store/files';

export type Severity = 'error' | 'warn';

export interface LintIssue {
  code: string;       // STANCE / D10 / D11 / D14 / D16 / DATA-5 / SLOP-*
  severity: Severity;
  path?: string;      // 涉及文件(可能无 — STANCE 等跨文件检查)
  slug?: string;      // 涉及 variant slug(D10/D11/D16 用)
  msg: string;
  hint?: string;      // 修复建议(给 LLM 用)
}

export interface LintReport {
  issues: LintIssue[];
  scanned: { files: number; variants: number };
}

// === 词族表(跟 detectors.ts 保持一致)===
const CONSERVATIVE = [
  '保守', '克制', '贴现状', '常规', '默认', '稳妥', '低调', '基础', '锚定',
  'conservative', 'restrained', 'anchor', 'orthodox', 'default', 'safe',
  'minimal', 'stable', 'baseline', 'cautious',
];
const MIDDLE = [
  '中位', '中间', 'balanced', 'middle', 'moderate', 'intermediate',
  'one departure', '一步', '中和',
];
const BOLD = [
  '大胆', '激进', '极端', '探索', '推到', '突破', '冒险', '冲击', '前卫',
  '实验', '激进派',
  'bold', 'aggressive', 'radical', 'exploratory', 'experimental',
  'pushed', 'extreme', 'daring', 'unconventional', 'adventurous',
];

const BAD_SLUGS = new Set([
  'a', 'b', 'c', 'd', 'e',
  'variant-1', 'variant-2', 'variant-3', 'variant1', 'variant2', 'variant3',
  'one', 'two', 'three',
  'editorial', 'minimal', 'bold', 'modern', 'clean', 'simple',
  'dark', 'light', 'colorful',
]);

// AI-slop tells — 这些是 "AI 写出来的设计" 的典型痕迹
const SLOP_PATTERNS: Array<{ code: string; re: RegExp; msg: string }> = [
  { code: 'SLOP-CTA', re: /\b(Submit|Click Here|Learn More|Get Started Now)\b/gi,
    msg: 'vague CTA — use specific action verb tied to user goal' },
  { code: 'SLOP-LOREM', re: /\b(lorem ipsum|consectetur adipiscing)\b/gi,
    msg: 'lorem placeholder leaked into delivery — use real-shape data or labeled placeholder' },
  // 紫蓝渐变(linear-gradient with purple→blue)is a classic AI tell
  { code: 'SLOP-GRADIENT', re: /linear-gradient\([^)]*(#6366f1|#8b5cf6|#a855f7|#7c3aed|purple|violet|indigo)[^)]*(#3b82f6|#06b6d4|#2563eb|blue|cyan)/gi,
    msg: 'purple→blue gradient is a strong AI-design tell — pick a single brand color or use a non-gradient surface' },
  // generic icon spam(sparkles 等)— 用 unicode regex
  { code: 'SLOP-SPARKLES', re: /[✨💫🪄🌟]{1}/g,
    msg: 'sparkle/magic emoji used as decoration — remove or replace with semantic icon' },
];

function detectRiskFamily(text: string): 'conservative' | 'middle' | 'bold' | null {
  const lower = text.toLowerCase();
  if (CONSERVATIVE.some((w) => lower.includes(w.toLowerCase()))) return 'conservative';
  if (BOLD.some((w) => lower.includes(w.toLowerCase()))) return 'bold';
  if (MIDDLE.some((w) => lower.includes(w.toLowerCase()))) return 'middle';
  return null;
}

/** 取 variant 文件头部 3000 字符,合并所有注释内容 */
function collectComments(content: string): string {
  const head = content.slice(0, 3000);
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  const htmlRe = /<!--([\s\S]*?)-->/g;
  while ((m = htmlRe.exec(head))) parts.push(m[1]);
  const blockRe = /\/\*([\s\S]*?)\*\//g;
  while ((m = blockRe.exec(head))) parts.push(m[1]);
  return parts.join('\n');
}

/** 主入口 — 跑 cross-file 检查 */
export async function lintDesign(projectId: number): Promise<LintReport> {
  const allFiles = await listFiles(projectId);
  const issues: LintIssue[] = [];

  // 1. variants/<slug>/index.html 集合
  const variantFiles = allFiles
    .filter((f) => /^variants\/[^/]+\/index\.html?$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path)); // 稳定顺序 → A/B/C 位置

  const variantSlugs = variantFiles.map((f) =>
    f.path.match(/^variants\/([^/]+)\//i)![1],
  );

  // === D14 — 变体数 ≤ 4 ===
  if (variantSlugs.length > 4) {
    issues.push({
      code: 'D14',
      severity: 'warn',
      msg: `${variantSlugs.length} variants 超出 4 个建议上限,用户进入决策疲劳区。`,
      hint: 'delete_file 删掉最不被偏好的旧 variant,或合并相近的两个。',
    });
  }

  // === D16 — slug 不在黑名单 ===
  for (const slug of variantSlugs) {
    if (BAD_SLUGS.has(slug.toLowerCase())) {
      issues.push({
        code: 'D16',
        severity: 'warn',
        slug,
        msg: `variant slug "${slug}" 太通用,无法暴露变化轴(应描述轴值,如 single-column-narrative)。`,
        hint: '用 kebab-case 反映轴的取值,而非 generic 词。',
      });
    }
  }

  // === D10 / D11 — 每个 variant 注释 ===
  for (let i = 0; i < variantFiles.length; i++) {
    const f = variantFiles[i];
    const slug = variantSlugs[i];
    const content = (await readFile(projectId, f.path).catch(() => null))?.content;
    if (typeof content !== 'string') continue;
    const comments = collectComments(content);

    // D10 — DNA / Fits / Tradeoff 三行齐
    const has3 =
      /\bDNA\s*[:：]/i.test(comments) &&
      /\bFits\s*[:：]/i.test(comments) &&
      /\bTradeoff\s*[:：]/i.test(comments);
    if (!has3) {
      issues.push({
        code: 'D10',
        severity: 'warn',
        path: f.path,
        slug,
        msg: 'variant 头部注释缺 DNA / Fits / Tradeoff 三行(SKILL.md Artifact 7)。',
        hint: '在文件最顶部加块注释 /* X · slug \\n * DNA: ... \\n * Fits: ... \\n * Tradeoff: ... */',
      });
      continue;
    }

    // D11 — 风险家族词按位置(A=conservative, B=middle, C=bold)
    // 但只在 ≥2 个 variant 时才检查梯度
    if (variantFiles.length >= 2) {
      const family = detectRiskFamily(comments);
      const expected =
        i === 0
          ? 'conservative'
          : i === variantFiles.length - 1
            ? 'bold'
            : 'middle';
      if (!family) {
        issues.push({
          code: 'D11',
          severity: 'warn',
          path: f.path,
          slug,
          msg: `variant ${slug} 注释无任何风险家族词,无法表达 A/B/C 风险梯度。`,
          hint: `按位置 (${i === 0 ? 'A=保守' : i === variantFiles.length - 1 ? 'C=大胆' : 'B=中位'}) 加一个对应家族词:${
            expected === 'conservative'
              ? CONSERVATIVE.slice(0, 3).join(' / ')
              : expected === 'bold'
                ? BOLD.slice(0, 3).join(' / ')
                : MIDDLE.slice(0, 3).join(' / ')
          } 任选其一。`,
        });
      }
    }
  }

  // === STANCE — commitment 块的 Stance 行必含 `not` ===
  // 扫所有 HTML/CSS 文件头部,找 "Design commitment:" 块
  for (const f of allFiles) {
    if (!/\.(html|css|js|jsx)$/i.test(f.path)) continue;
    const content = (await readFile(projectId, f.path).catch(() => null))?.content;
    if (typeof content !== 'string') continue;
    const head = content.slice(0, 2000);
    const m = head.match(/Design commitment:[\s\S]{0,500}?Stance:\s*([^\n*]+)/i);
    if (!m) continue;
    const stance = m[1].trim();
    // 检查是否含 "not" 或 "不是" / "非"
    if (!/\b(not|isn't|aren't)\b/i.test(stance) && !/[不非]/.test(stance)) {
      issues.push({
        code: 'STANCE',
        severity: 'warn',
        path: f.path,
        msg: `Stance "${stance.slice(0, 60)}..." 不含 "not"/"不",不是 falsifiable 立场。`,
        hint: 'Stance 必须是用户能 reject 的 claim:格式 "X, not Y" / "X,不是 Y"。',
      });
    }
  }

  // === DATA-5 — shared/data.{js,ts} 5 个 state 齐 ===
  const dataFile = allFiles.find((f) =>
    /^shared\/data\.(js|ts|mjs)$/i.test(f.path),
  );
  if (dataFile && variantFiles.length >= 2) {
    const content = (await readFile(projectId, dataFile.path).catch(() => null))?.content;
    if (typeof content === 'string') {
      const required = ['normal', 'empty', 'busy', 'partialFail', 'longText'];
      const missing = required.filter((k) => {
        // 简单字符串匹配:key 或 string-key 都算
        const re = new RegExp(`\\b${k}\\s*:|"${k}"\\s*:|'${k}'\\s*:`);
        return !re.test(content);
      });
      if (missing.length > 0) {
        issues.push({
          code: 'DATA-5',
          severity: 'warn',
          path: dataFile.path,
          msg: `DATA_STATES 缺 ${missing.length} 个 state: ${missing.join(', ')}。`,
          hint: 'normal / empty / busy / partialFail / longText 5 个必须齐全,不允许 // TODO 占位。边缘状态是设计崩盘的地方。',
        });
      }
    }
  } else if (variantFiles.length >= 2 && !dataFile) {
    issues.push({
      code: 'DATA-5',
      severity: 'warn',
      msg: 'multi-variant 项目缺 shared/data.{js,ts} 文件(DATA_STATES 5 件套该有的地方)。',
      hint: '写 shared/data.js,export 一个 DATA_STATES 含 normal/empty/busy/partialFail/longText 5 个 state。',
    });
  }

  // === SLOP — AI-slop tells 在 variants/ 内 ===
  for (const f of variantFiles) {
    const content = (await readFile(projectId, f.path).catch(() => null))?.content;
    if (typeof content !== 'string') continue;
    for (const p of SLOP_PATTERNS) {
      const matches = content.match(p.re);
      if (matches && matches.length > 0) {
        issues.push({
          code: p.code,
          severity: 'warn',
          path: f.path,
          msg: `${p.msg} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`,
        });
      }
    }
  }

  return {
    issues,
    scanned: { files: allFiles.length, variants: variantFiles.length },
  };
}

/** 格式化成 tool_result 友好的字符串 */
export function formatLintReport(report: LintReport): string {
  if (report.issues.length === 0) {
    return `\n\n[design-lint] ✓ clean — ${report.scanned.files} files, ${report.scanned.variants} variants scanned.`;
  }
  const lines: string[] = [
    `\n\n[design-lint] ⚠ ${report.issues.length} issue(s):`,
  ];
  for (const i of report.issues) {
    const loc = i.path ? ` (${i.path})` : '';
    lines.push(`  - ${i.code}${loc}: ${i.msg}`);
    if (i.hint) lines.push(`    → fix: ${i.hint}`);
  }
  lines.push(
    `  Scanned ${report.scanned.files} files, ${report.scanned.variants} variants. ` +
      `Fix issues before done() — Phase 8 5-item gate depends on a clean lint.`,
  );
  return lines.join('\n');
}
