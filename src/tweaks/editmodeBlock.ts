/* EDITMODE block — host-direct Tweaks (no LLM round-trip)
 *
 * Inline TWEAK marker 是 v1 方案:精确标记单个字面量,每次改要走 LLM。
 * EDITMODE block 是 v2 方案:文件里嵌一段 JSON,host 直接 parse + 写值。
 *
 * Schema:
 *   /​*EDITMODE-BEGIN*​/{
 *     "primary": "#0f172a",
 *     "density": "balanced",
 *     "fontSize": 16,
 *     "dark": false
 *   }/​*EDITMODE-END*​/
 *
 * 控件类型从 value 类型推断:
 *   boolean → toggle
 *   number  → slider (默认 0-100;若 key 含 "px"/"size" 给合理范围)
 *   string  → /^#[0-9a-f]{3,8}$/i → color picker
 *           → else → text input
 *
 * 可选 schema 注释(就在 EDITMODE-BEGIN 上一行):
 *   /​*EDITMODE-META {"primary":{"type":"color","label":"主色"},"fontSize":{"type":"number","min":12,"max":48,"step":1}}*​/
 *   /​*EDITMODE-BEGIN*​/{ ... }/​*EDITMODE-END*​/
 *
 * 块可以在 .html / .css / .js / .jsx / .ts 任何文件里;host 自动扫所有项目文件
 */

import { listFiles, readFile, writeFile } from '../store/files';
import type { WriteSource } from '../store/files';

export type EditmodeValueType = 'color' | 'text' | 'number' | 'toggle' | 'select';

export interface EditmodeFieldMeta {
  type?: EditmodeValueType;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];        // for select
}

export interface EditmodeField {
  key: string;
  value: string | number | boolean;
  type: EditmodeValueType;
  label: string;
  filePath: string;
  blockIndex: number;       // 文件里第几个 EDITMODE 块(0-based,支持多块)
  meta?: EditmodeFieldMeta;
}

const BLOCK_RE = /\/\*\s*EDITMODE-BEGIN\s*\*\/([\s\S]*?)\/\*\s*EDITMODE-END\s*\*\//g;
const META_RE = /\/\*\s*EDITMODE-META\s+([\s\S]+?)\s*\*\//g;

function inferTypeFromValue(key: string, value: unknown, meta?: EditmodeFieldMeta): EditmodeValueType {
  if (meta?.type) return meta.type;
  if (typeof value === 'boolean') return 'toggle';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return 'color';
    if (/^rgba?\(/.test(value) || /^hsla?\(/.test(value) || /^oklch\(/.test(value)) return 'color';
    if (/color|bg|background/i.test(key)) return 'color';
  }
  return 'text';
}

/** 扫单个文件,返回所有 EDITMODE 字段 */
export function parseEditmodeBlocks(
  filePath: string,
  content: string,
): EditmodeField[] {
  const fields: EditmodeField[] = [];

  // 1. 找 meta(可选,所有 META 块的内容合并)
  const metaMap: Record<string, EditmodeFieldMeta> = {};
  META_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = META_RE.exec(content))) {
    try {
      const obj = JSON.parse(m[1]) as Record<string, EditmodeFieldMeta>;
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') metaMap[k] = v;
      }
    } catch { /* ignore broken meta */ }
  }

  // 2. 找 BEGIN/END 块,逐个 parse
  BLOCK_RE.lastIndex = 0;
  let blockIndex = 0;
  while ((m = BLOCK_RE.exec(content))) {
    const raw = m[1].trim();
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [key, value] of Object.entries(obj)) {
          const meta = metaMap[key];
          fields.push({
            key,
            value: value as any,
            type: inferTypeFromValue(key, value, meta),
            label: meta?.label || key,
            filePath,
            blockIndex,
            meta,
          });
        }
      }
    } catch (e) {
      console.warn(`[editmode] parse failed in ${filePath} block ${blockIndex}:`, (e as Error).message);
    }
    blockIndex++;
  }

  return fields;
}

/** 扫所有项目文件 */
export async function listAllEditmodeFields(projectId: number): Promise<EditmodeField[]> {
  const all = await listFiles(projectId);
  const out: EditmodeField[] = [];
  for (const f of all) {
    if (!/\.(html?|css|js|mjs|ts|jsx|tsx|json)$/i.test(f.path)) continue;
    const file = await readFile(projectId, f.path).catch(() => null);
    if (!file || typeof file.content !== 'string') continue;
    out.push(...parseEditmodeBlocks(f.path, file.content));
  }
  return out;
}

/** 改一个字段的值 — 找对应文件的对应 block,替换那个 key 的 value,写回 */
export async function writeEditmodeValue(
  projectId: number,
  filePath: string,
  blockIndex: number,
  key: string,
  newValue: string | number | boolean,
  source: WriteSource = 'user',
): Promise<{ found: boolean; reason?: string }> {
  const file = await readFile(projectId, filePath).catch(() => null);
  if (!file || typeof file.content !== 'string') {
    return { found: false, reason: `file not found: ${filePath}` };
  }
  const content = file.content;

  // 定位第 blockIndex 个 EDITMODE-BEGIN/END 块
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let cur = -1;
  let match: { full: string; inner: string; start: number; end: number } | null = null;
  while ((m = BLOCK_RE.exec(content))) {
    cur++;
    if (cur === blockIndex) {
      match = {
        full: m[0],
        inner: m[1],
        start: m.index + m[0].indexOf(m[1]),
        end: m.index + m[0].indexOf(m[1]) + m[1].length,
      };
      break;
    }
  }
  if (!match) {
    return { found: false, reason: `block ${blockIndex} not found in ${filePath}` };
  }

  // parse + 改 key + stringify
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match.inner) as Record<string, unknown>;
  } catch (e) {
    return { found: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
  if (!(key in obj)) {
    return { found: false, reason: `key "${key}" not in block` };
  }
  obj[key] = newValue;

  // 保持原有 indentation 风格:看 inner 第一行 indent
  const newInner = JSON.stringify(obj, null, 2);
  const nextContent =
    content.slice(0, match.start) +
    newInner +
    content.slice(match.end);

  await writeFile(projectId, filePath, nextContent, file.type ?? 'text', source);
  return { found: true };
}
