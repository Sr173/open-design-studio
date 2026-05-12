/* Skill 章程章节 — read_skill 工具的数据源
 *
 * v1.9 改进:
 *   - 启动时**全部章节预渲染**进内存(章节数 < 15),后续 read_skill 走 O(1) lookup
 *   - phase-N 8 个章节合并成 "phases-build"(Phase 4-6) + "phases-iterate"(Phase 7-8),
 *     phase-1/2/3 保留单独(早期独立步骤,LLM 通常只需要其中一个)
 *   - sliceSection 退化保护:切出来 < 200 字符时 console.warn
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 源码模式 __dirname=server/ → ./skill.md;Electron bundled __dirname=dist-electron/ → ./skill.md(build 时复制过去)
function resolveSkill(): string {
  const candidates = [
    join(__dirname, 'skill.md'),
    join(__dirname, '..', 'server', 'skill.md'), // 兜底
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`skill.md not found in: ${candidates.join(' | ')}`);
}
const fullSkill = readFileSync(resolveSkill(), 'utf8');

/** 从 full skill.md 切出一段(基于 markdown header) */
function sliceSection(
  sectionId: string,
  startMarker: RegExp,
  endMarker?: RegExp
): string {
  const start = startMarker.exec(fullSkill);
  if (!start) {
    console.warn(`[skill-chapters] ${sectionId}: start marker 未命中`);
    return '';
  }
  const after = fullSkill.slice(start.index);
  if (!endMarker) return after;
  const end = endMarker.exec(after);
  if (!end || end.index === 0) return after;
  return after.slice(0, end.index);
}

function buildSections(): Record<string, string> {
  const out: Record<string, string> = {};

  // 完整 detectors 列表(D1-D16)
  out.detectors = sliceSection(
    'detectors',
    /^## Self-Check Detectors/m,
    /^## /m
  );

  // Phase 1-3(早期独立)
  out['phase-1'] = sliceSection('phase-1', /^### Phase 1 /m, /^### Phase 2 /m);
  out['phase-2'] = sliceSection('phase-2', /^### Phase 2 /m, /^### Phase 3 /m);
  out['phase-3'] = sliceSection('phase-3', /^### Phase 3 /m, /^### Phase 4 /m);

  // 多变体核心:Phase 4 commitment + 5 shared + 6 variants
  const phase4 = sliceSection('phase-4', /^### Phase 4 /m, /^### Phase 5 /m);
  const phase5 = sliceSection('phase-5', /^### Phase 5 /m, /^### Phase 6 /m);
  const phase6 = sliceSection('phase-6', /^### Phase 6 /m, /^### Phase 7 /m);
  out['phases-build'] = [
    '# Build phases (4-6) — sketch + checkpoint + shared + variants',
    phase4,
    phase5,
    phase6,
  ].join('\n\n');

  // Iterate + deliver
  const phase7 = sliceSection('phase-7', /^### Phase 7 /m, /^### Phase 8 /m);
  // phase-8 终止符:用下一个 ## 二级标题(比 ^--- 安全)
  const phase8 = sliceSection('phase-8', /^### Phase 8 /m, /^## /m);
  out['phases-iterate'] = [
    '# Iterate + Deliver phases (7-8)',
    phase7,
    phase8,
  ].join('\n\n');

  // multi-variant 别名 → phases-build(语义重合,留两个 id 方便 AI 想到哪个用哪个)
  out['multi-variant'] = out['phases-build'];

  out.aesthetic = sliceSection(
    'aesthetic',
    /^## Aesthetic guidance/m,
    /^## /m
  );

  // Tweak marker schema — 内联文字(独立于 skill.md,因为 skill.md 主要讲 prototype scope)
  out.tweaks = `# Tweak marker schema (per file type)

HTML:
\`\`\`html
<!-- TWEAK id="hero-bg" type="color" label="英雄区背景" -->
<div style="background: #ff8800"> ... </div>
<!-- /TWEAK -->
\`\`\`

CSS:
\`\`\`css
/* TWEAK id="brand-primary" type="color" label="品牌主色" */
:root { --brand: #ff8800; }
/* /TWEAK */
\`\`\`

JS (must be on variable declarations,**not inside JSX return**):
\`\`\`js
// TWEAK id="hero-headline" type="text" label="英雄区标题"
const HEADLINE = "立即开始你的设计之旅";
// /TWEAK
\`\`\`

Types: color / text / number{min,max,step} / select{options="a|b|c"} / toggle
Single-literal values only. Complex expressions: don't mark.

Good places: brand color var, hero headline, key spacing number, density toggle.
Bad places: dynamic computed values, anything inside arrays/objects.`;

  // === Sanity check:每个 section 长度 ===
  for (const [k, v] of Object.entries(out)) {
    if (v.trim().length < 200) {
      console.warn(
        `[skill-chapters] ⚠ section "${k}" 切出来 ${v.length} 字符,可能 skill.md 结构变了。检查 sliceSection regex。`
      );
    }
  }

  return out;
}

// 启动时一次性预渲染(章节数有限,~10 个)
const SECTIONS_CACHE: Record<string, string> = buildSections();

export function listSkillSections(): string[] {
  return Object.keys(SECTIONS_CACHE);
}

export function readSkillSection(section: string): string | null {
  const body = SECTIONS_CACHE[section];
  if (!body) return null;
  return body.trim() || null;
}
