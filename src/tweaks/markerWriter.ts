/* Tweak marker 回写 — 按 marker id 定位 + 单值字面量替换
 *
 * 1. 重新解析当前文件(避免 stale offset)
 * 2. 找到目标 marker 的 valueStart/valueEnd
 * 3. 把字面量按 type 重新格式化(text 加引号、color 不加等)
 * 4. 替换写回文件
 */

import { listFiles, writeFile } from '../store/files';
import {
  parseMarkersInFile,
  type TweakMarker,
  type TweakType,
} from './markerParser';

export interface WriteResult {
  found: boolean;
  path?: string;
  before?: string;
  after?: string;
}

export async function writeTweakValue(
  projectId: number,
  tweakId: string,
  newValue: string,
  source: 'user' | 'ai' = 'user'
): Promise<WriteResult> {
  const files = await listFiles(projectId);
  for (const f of files) {
    if (f.type !== 'text') continue;
    const markers = parseMarkersInFile(f.path, f.content);
    const target = markers.find((m) => m.attrs.id === tweakId);
    if (!target) continue;
    const before = target.currentValue;
    const newLiteral = formatLiteral(newValue, target.attrs.type, target);
    const next =
      f.content.slice(0, target.valueStart) +
      newLiteral +
      f.content.slice(target.valueEnd);
    if (next !== f.content) {
      await writeFile(projectId, f.path, next, 'text', source);
    }
    return { found: true, path: f.path, before, after: newValue };
  }
  return { found: false };
}

function formatLiteral(
  value: string,
  type: TweakType,
  marker: TweakMarker
): string {
  if (type === 'text' || type === 'select') {
    // 用与原字面量同样的引号
    const orig = marker.currentLiteral;
    const quote = orig.startsWith("'") ? "'" : '"';
    return quote + escapeForQuote(value, quote) + quote;
  }
  if (type === 'toggle') {
    if (marker.fileLang === 'js') {
      return value === 'true' ? 'true' : 'false';
    }
    // HTML/CSS — 若原文是 "true" 字面量则保留引号
    if (marker.currentLiteral.startsWith('"') || marker.currentLiteral.startsWith("'")) {
      const q = marker.currentLiteral[0];
      return q + (value === 'true' ? 'true' : 'false') + q;
    }
    return value === 'true' ? 'true' : 'false';
  }
  if (type === 'number') {
    return String(value);
  }
  // color 直接替换
  return value;
}

function escapeForQuote(s: string, q: string): string {
  // 转义引号 + 反斜杠 + 换行
  return s
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(q, 'g'), '\\' + q)
    .replace(/\r?\n/g, '\\n');
}

export async function listAllMarkers(
  projectId: number
): Promise<TweakMarker[]> {
  const files = await listFiles(projectId);
  const out: TweakMarker[] = [];
  for (const f of files) {
    if (f.type !== 'text') continue;
    out.push(...parseMarkersInFile(f.path, f.content));
  }
  return out;
}

/** 导出时 strip TWEAK marker 注释,保留中间内容 */
export function stripTweakMarkers(filePath: string, content: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return content
      .replace(/<!--\s*TWEAK\b[^>]*?-->/g, '')
      .replace(/<!--\s*\/\s*TWEAK\s*-->/g, '');
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss')) {
    return content
      .replace(/\/\*\s*TWEAK\b[\s\S]*?\*\//g, '')
      .replace(/\/\*\s*\/\s*TWEAK\s*\*\//g, '');
  }
  if (lower.endsWith('.js') || lower.endsWith('.ts')) {
    return content
      .replace(/(^|\n)\s*\/\/\s*TWEAK\b[^\n]*/g, '$1')
      .replace(/(^|\n)\s*\/\/\s*\/\s*TWEAK\s*(?=\n|$)/g, '$1');
  }
  return content;
}
