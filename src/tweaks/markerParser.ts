/* Tweak marker 解析 — 见 plan「Tweak Marker schema」节
 *
 * 按文件后缀路由不同正则;v1 不支持 JSX(推到 v4 跟 Babel 一起开)
 *   .html/.htm:  <!-- TWEAK ... --> ... <!-- /TWEAK -->
 *   .css/.scss:  /* TWEAK ... *‍/ ... /* /TWEAK *‍/
 *   .js/.ts:     // TWEAK ... ↵ <声明> ↵ // /TWEAK
 *
 * 块内寻找首个匹配 type 的字面量作为当前值
 *   color → 首个 #hex / rgb() / hsl() / oklch() / 颜色名(简化)
 *   text  → 首个 "..." 或 '...'
 *   number → 首个 数字字面量
 *   select → 同 text
 *   toggle → 首个 true/false(JS)/ "true"/"false" 字面量
 */

export type FileLang = 'html' | 'css' | 'js';

export type TweakType = 'color' | 'text' | 'number' | 'select' | 'toggle';

export interface TweakAttrs {
  id: string;
  type: TweakType;
  label?: string;
  options?: string[];      // for select
  min?: number;
  max?: number;
  step?: number;
}

export interface TweakMarker {
  filePath: string;
  fileLang: FileLang;
  attrs: TweakAttrs;
  /** marker 块整体在文件中的字节范围(用于替换) */
  blockStart: number;
  blockEnd: number;
  /** 块内首个匹配字面量的范围 */
  valueStart: number;
  valueEnd: number;
  /** 当前字面量原文(含引号等) */
  currentLiteral: string;
  /** 提取出的"语义值"(不含引号、空白等)*/
  currentValue: string;
}

export function detectFileLang(path: string): FileLang | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return 'js';
  return null;
}

interface FenceRe {
  open: RegExp;
  closeFor: (attrsStr: string) => RegExp;
}

const FENCE: Record<FileLang, FenceRe> = {
  html: {
    open: /<!--\s*TWEAK\b([^>]*?)-->/g,
    closeFor: () => /<!--\s*\/\s*TWEAK\s*-->/,
  },
  css: {
    open: /\/\*\s*TWEAK\b([\s\S]*?)\*\//g,
    closeFor: () => /\/\*\s*\/\s*TWEAK\s*\*\//,
  },
  js: {
    open: /(^|\n)\s*\/\/\s*TWEAK\b([^\n]*)/g,
    closeFor: () => /(^|\n)\s*\/\/\s*\/\s*TWEAK\s*(?=\n|$)/,
  },
};

export function parseMarkersInFile(
  filePath: string,
  content: string
): TweakMarker[] {
  const lang = detectFileLang(filePath);
  if (!lang) return [];
  const fence = FENCE[lang];
  const out: TweakMarker[] = [];

  fence.open.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.open.exec(content))) {
    const attrsStr = lang === 'js' ? m[2] : m[1];
    const attrs = parseAttrs(attrsStr);
    if (!attrs) continue;

    const openEnd = m.index + m[0].length;
    const closeRe = fence.closeFor(attrsStr);
    closeRe.lastIndex = 0;
    const remainder = content.slice(openEnd);
    const closeMatch = closeRe.exec(remainder);
    if (!closeMatch) continue;

    const closeStart = openEnd + closeMatch.index;
    const blockStart = m.index;
    const blockEnd = closeStart + closeMatch[0].length;

    // 在 [openEnd, closeStart) 里找首个匹配字面量
    const inner = content.slice(openEnd, closeStart);
    const lit = findValueLiteral(inner, attrs.type);
    if (!lit) continue;

    out.push({
      filePath,
      fileLang: lang,
      attrs,
      blockStart,
      blockEnd,
      valueStart: openEnd + lit.start,
      valueEnd: openEnd + lit.end,
      currentLiteral: lit.literal,
      currentValue: lit.value,
    });
  }
  return out;
}

// === attrs parsing ===

function parseAttrs(attrsStr: string): TweakAttrs | null {
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"']+))/g;
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsStr))) {
    const key = m[1];
    const val = m[3] ?? m[4] ?? m[5] ?? '';
    attrs[key] = val;
  }
  if (!attrs.id || !attrs.type) return null;
  if (!isTweakType(attrs.type)) return null;

  const out: TweakAttrs = {
    id: attrs.id,
    type: attrs.type as TweakType,
  };
  if (attrs.label) out.label = attrs.label;
  if (attrs.options) {
    out.options = attrs.options.split('|').map((s) => s.trim()).filter(Boolean);
  }
  if (attrs.min) out.min = parseFloat(attrs.min);
  if (attrs.max) out.max = parseFloat(attrs.max);
  if (attrs.step) out.step = parseFloat(attrs.step);
  return out;
}

function isTweakType(t: string): t is TweakType {
  return ['color', 'text', 'number', 'select', 'toggle'].includes(t);
}

// === literal finders ===

interface LiteralHit {
  start: number;
  end: number;
  literal: string;     // 含引号
  value: string;       // 不含引号
}

function findValueLiteral(inner: string, type: TweakType): LiteralHit | null {
  if (type === 'color') {
    return findColor(inner);
  }
  if (type === 'number') {
    return findNumber(inner);
  }
  if (type === 'toggle') {
    return findToggle(inner);
  }
  // text / select 都用 quoted string
  return findString(inner);
}

function findColor(s: string): LiteralHit | null {
  const re =
    /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([^)]+\)/;
  const m = re.exec(s);
  if (!m) return null;
  return {
    start: m.index,
    end: m.index + m[0].length,
    literal: m[0],
    value: m[0],
  };
}

function findNumber(s: string): LiteralHit | null {
  // 跳过 marker attr 已包含的引号字符串内的数字 — 我们 inner 已经不含 marker 标签
  const re = /(^|[^a-zA-Z_$\d.])(-?\d+(?:\.\d+)?)/;
  const m = re.exec(s);
  if (!m) return null;
  const offset = m.index + m[1].length;
  return {
    start: offset,
    end: offset + m[2].length,
    literal: m[2],
    value: m[2],
  };
}

function findToggle(s: string): LiteralHit | null {
  // JS 直接 true/false;HTML/CSS 里若 marker 圈一个 attribute 也可识别 "true"/"false"
  const re = /\b(true|false)\b/;
  const m = re.exec(s);
  if (!m) return null;
  return {
    start: m.index,
    end: m.index + m[0].length,
    literal: m[0],
    value: m[0],
  };
}

function findString(s: string): LiteralHit | null {
  const re = /(["'])((?:\\.|(?!\1).)*)\1/;
  const m = re.exec(s);
  if (!m) return null;
  return {
    start: m.index,
    end: m.index + m[0].length,
    literal: m[0],
    value: m[2],
  };
}
