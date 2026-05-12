/* Skill 章程章节 — read_skill 工具的数据源
 *
 * 每个章节按需注入,不进入常驻 system prompt(避免注意力摊薄)。
 * 章节用 ASCII id(detectors / multi-variant / aesthetic / phase-1...8 / tweaks)。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fullSkill = readFileSync(join(__dirname, 'skill.md'), 'utf8');

/** 从 full skill.md 切出一段(基于 markdown header) */
function sliceSection(startMarker: RegExp, endMarker?: RegExp): string {
  const start = startMarker.exec(fullSkill);
  if (!start) return '';
  const after = fullSkill.slice(start.index);
  if (!endMarker) return after;
  const end = endMarker.exec(after);
  if (!end || end.index === 0) return after;
  return after.slice(0, end.index);
}

const SECTIONS: Record<string, () => string> = {
  // 完整 detectors 列表(D1-D16)
  detectors: () =>
    sliceSection(/^## Self-Check Detectors/m, /^## /m),

  // 多变体所有规则
  'multi-variant': () => {
    const phase4 = sliceSection(/^### Phase 4 — Sketch \+ Checkpoint/m, /^### Phase 5 /m);
    const phase5 = sliceSection(/^### Phase 5 — Extract shared/m, /^### Phase 6/m);
    const phase6 = sliceSection(/^### Phase 6 — Variants/m, /^### Phase 7/m);
    const phase7 = sliceSection(/^### Phase 7 — Iterate/m, /^### Phase 8/m);
    return [
      '# Multi-variant chapter (Phase 4-7 selected)',
      phase4,
      phase5,
      phase6,
      phase7,
    ].join('\n\n');
  },

  aesthetic: () =>
    sliceSection(/^## Aesthetic guidance/m, /^## /m),

  tweaks: () => {
    // Tweak marker 在 v3 runtime mapping coda 里;这里返回 marker schema 提示
    return `# Tweak marker schema (per file type)

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
  },

  'phase-1': () => sliceSection(/^### Phase 1 /m, /^### Phase 2 /m),
  'phase-2': () => sliceSection(/^### Phase 2 /m, /^### Phase 3 /m),
  'phase-3': () => sliceSection(/^### Phase 3 /m, /^### Phase 4 /m),
  'phase-4': () => sliceSection(/^### Phase 4 /m, /^### Phase 5 /m),
  'phase-5': () => sliceSection(/^### Phase 5 /m, /^### Phase 6 /m),
  'phase-6': () => sliceSection(/^### Phase 6 /m, /^### Phase 7 /m),
  'phase-7': () => sliceSection(/^### Phase 7 /m, /^### Phase 8 /m),
  'phase-8': () => sliceSection(/^### Phase 8 /m, /^---/m),
};

export function listSkillSections(): string[] {
  return Object.keys(SECTIONS);
}

export function readSkillSection(section: string): string | null {
  const fn = SECTIONS[section];
  if (!fn) return null;
  const body = fn().trim();
  return body || null;
}
