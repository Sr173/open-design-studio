/* 多变体探测 — 扫项目文件,识别 variants/<slug>/index.html
 *
 * 约定(对应 skill Phase 5 + 后端 systemPrompt):
 *   variants/<slug>/index.html   ← 每个变体的入口
 *   shared/...                    ← variants 共享的 css/js
 *
 * 单 track:根目录 index.html。Variant 列表为空。
 */

import type { ProjectFile } from '../store/db';

export interface VariantInfo {
  slug: string;
  path: string;            // 相对项目根的入口路径,如 variants/sidebar-led/index.html
  /** 从 HTML 头部 (slash-star X · name star-slash) 注释里提取的 name;取不到则 fallback 到 slug */
  displayName: string;
  /** DNA 一句话(从注释提取),给 tooltip / delivery 用 */
  dna?: string;
  fits?: string;
  tradeoff?: string;
}

const VARIANT_RE = /^variants\/([^/]+)\/index\.html?$/i;

export function detectVariants(files: ProjectFile[]): VariantInfo[] {
  const out: VariantInfo[] = [];
  for (const f of files) {
    const m = VARIANT_RE.exec(f.path);
    if (!m) continue;
    const slug = m[1];
    const meta = parseMetaComment(f.content);
    out.push({
      slug,
      path: f.path,
      displayName: meta.name ?? slug,
      dna: meta.dna,
      fits: meta.fits,
      tradeoff: meta.tradeoff,
    });
  }
  // 按 slug 字母排序,稳定显示
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/** 解析 HTML 顶部的 block 注释 — 里面应有 "A · name" / "DNA: ..." / "Fits: ..." / "Tradeoff: ..." */
function parseMetaComment(html: string): {
  name?: string;
  dna?: string;
  fits?: string;
  tradeoff?: string;
} {
  // 匹配开头的 /* ... */ 注释(可能在 <!DOCTYPE> 之前或 <body> 里)
  const m = /\/\*([\s\S]*?)\*\//.exec(html.slice(0, 1500));
  if (!m) return {};
  const body = m[1];
  const lines = body.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim());

  let name: string | undefined;
  let dna: string | undefined;
  let fits: string | undefined;
  let tradeoff: string | undefined;

  for (const ln of lines) {
    // "A · name" 形式
    const headMatch = /^[A-Z]\s*·\s*(.+)$/.exec(ln);
    if (headMatch && !name) name = headMatch[1].trim();
    const dnaMatch = /^DNA\s*[:：]\s*(.+)$/i.exec(ln);
    if (dnaMatch) dna = dnaMatch[1].trim();
    const fitsMatch = /^Fits\s*[:：]\s*(.+)$/i.exec(ln);
    if (fitsMatch) fits = fitsMatch[1].trim();
    const tradeMatch = /^Tradeoff\s*[:：]\s*(.+)$/i.exec(ln);
    if (tradeMatch) tradeoff = tradeMatch[1].trim();
  }
  return { name, dna, fits, tradeoff };
}
