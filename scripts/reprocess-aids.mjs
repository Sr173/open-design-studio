#!/usr/bin/env node
/* reprocess-aids — 对 .design/ 下所有 HTML 跑一遍 postProcess
 *
 * 用法:
 *   pnpm reprocess-aids <project-folder>
 *   pnpm reprocess-aids /Users/fan/repo
 *   pnpm reprocess-aids .            # 当前目录
 *
 * 何时用:
 *   - 手动改过 HTML 后 inspect/edit 失效(本次的情况)
 *   - AI 写入时 postProcess 报警 fail-open 留下无 aid 的文件
 *   - 把别的项目的 HTML 拷贝进来,需要补 aid
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 用 tsx 跑 postProcess.ts(避免编译 ts 步骤)
const { postProcessOnWrite } = await import(
  // tsx 已经 hook,可以直接 import .ts
  join(rootDir, 'src/preview/postProcess.ts')
);

const projectFolder = process.argv[2];
if (!projectFolder) {
  console.error('usage: reprocess-aids <project-folder>');
  process.exit(1);
}

const designDir = join(projectFolder, '.design');
let stat;
try {
  stat = statSync(designDir);
} catch {
  console.error(`error: ${designDir} 不存在`);
  process.exit(1);
}
if (!stat.isDirectory()) {
  console.error(`error: ${designDir} 不是目录`);
  process.exit(1);
}

let processed = 0;
let skipped = 0;
let totalAdded = 0;

function walk(dir, relPrefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (['node_modules', 'dist'].includes(e.name)) continue;
    const full = join(dir, e.name);
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walk(full, rel);
    } else if (e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.htm'))) {
      const before = readFileSync(full, 'utf8');
      const after = postProcessOnWrite(rel, before);
      const beforeAids = (before.match(/data-aid/g) || []).length;
      const afterAids = (after.match(/data-aid/g) || []).length;
      if (after === before) {
        skipped++;
        console.log(`  ✓ ${rel} (already has ${beforeAids} aids)`);
      } else {
        writeFileSync(full, after);
        processed++;
        const added = afterAids - beforeAids;
        totalAdded += added;
        console.log(`  ✚ ${rel} (+${added} aids, ${beforeAids} → ${afterAids})`);
      }
    }
  }
}

console.log(`[reprocess-aids] scanning ${designDir}\n`);
walk(designDir);
console.log(`\ndone: ${processed} files updated (+${totalAdded} aids), ${skipped} unchanged`);
