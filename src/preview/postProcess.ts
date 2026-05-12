/* 写入前自动注入 data-aid + (v3) 移除 — 见 plan「元素 ID 方案」节
 *
 * 用 node-html-parser(同构,前后端都能跑)替代原来的正则方案。
 * 正则在 JSX / 嵌套 / 注释 / 属性值含 `>` 等场景会出 bug,DOM parser 更稳。
 *
 * 行为:
 *   - 给语义元素白名单(h1-h6 / p / li / button / a / img / section / ...)注入 data-aid
 *   - 跳过 div / span (除非有纯 text 子代)
 *   - 已有 data-aid 不动
 *   - HTML 注释 / <script> / <style> 内部不动
 */

import { parse, HTMLElement } from 'node-html-parser';
import { customAlphabet } from 'nanoid';

const newAid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** 始终注入的标签 — 文本 / 交互 / 媒体 / 容器 */
const ALWAYS_INJECT = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'blockquote', 'figcaption',
  'button', 'a', 'input', 'textarea', 'select', 'label',
  'img', 'video', 'audio',
  'section', 'article', 'main', 'aside', 'header', 'footer', 'nav',
]);

/** 这些标签即使含 text node 也不注 aid — 它们的 text 是脚本/样式而非用户内容 */
const SKIP_CONTENT = new Set(['script', 'style', 'template', 'noscript']);

/** div / span — 仅当含直接 text node 且无元素子代时才注入 */
const TEXT_HOLDERS_OPT_IN = new Set(['div', 'span']);

function shouldInject(el: HTMLElement): boolean {
  const tag = el.rawTagName?.toLowerCase();
  if (!tag) return false;
  if (SKIP_CONTENT.has(tag)) return false;
  if (el.hasAttribute('data-aid')) return false;
  if (ALWAYS_INJECT.has(tag)) return true;
  if (TEXT_HOLDERS_OPT_IN.has(tag)) {
    // 含直接 text node 且无元素子代
    let hasText = false;
    let hasElement = false;
    for (const child of el.childNodes) {
      // nodeType 3 = text, 1 = element (node-html-parser uses similar conventions)
      if (child.nodeType === 1) hasElement = true;
      else if (child.nodeType === 3) {
        if (child.text.trim().length > 0) hasText = true;
      }
    }
    return hasText && !hasElement;
  }
  return false;
}

function walk(el: HTMLElement, visit: (e: HTMLElement) => void): void {
  if (!el) return;
  const tag = el.rawTagName?.toLowerCase();
  if (tag && SKIP_CONTENT.has(tag)) return;
  visit(el);
  for (const child of el.childNodes) {
    if (child.nodeType === 1) walk(child as HTMLElement, visit);
  }
}

/** 给 HTML 字符串中所有白名单标签注入 data-aid(已有则保留) */
export function injectAids(html: string): string {
  const root = parse(html, {
    comment: true,
    voidTag: { closingSlash: true },
    blockTextElements: { script: true, style: true, pre: true, textarea: true },
  });
  walk(root as unknown as HTMLElement, (el) => {
    if (shouldInject(el)) {
      el.setAttribute('data-aid', newAid());
    }
  });
  return root.toString();
}

/**
 * 入口:文件入库前调用。仅对 .html / .htm 起作用。
 * 其他文件(css/js/二进制)直接返回原内容。
 */
export function postProcessOnWrite(path: string, content: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    try {
      return injectAids(content);
    } catch (e) {
      // parser 出错时,fail-open:返回原内容(总比写不进去好)
      console.warn('[postProcess] parser failed,保留原内容:', e);
      return content;
    }
  }
  return content;
}

/** 反向操作:导出"干净版"时 strip 掉所有 data-aid */
export function stripAids(html: string): string {
  return html.replace(/\s+data-aid="[a-z0-9]+"/gi, '');
}
