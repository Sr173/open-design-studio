/* 写入前自动注入 data-aid — 见 plan「元素 ID 方案」节
 *
 * 理念:确定性后处理,不靠 prompt。AI 不需要在 HTML 里写 data-aid;
 * 客户端在 write_file 入库前给语义元素白名单自动加 8 字符 hash ID。
 *
 * 白名单(plan):
 *   - 文本类:h1-h6 / p / li / blockquote / figcaption
 *   - 交互类:button / a / input / textarea / select / label
 *   - 媒体类:img / video / audio
 *   - 容器类:section / article / main / aside / header / footer / nav
 *
 * 跳过:div / span(默认),除非有直接 text node 子代但无元素子代(v1 不实现这个细节)
 */

import { customAlphabet } from 'nanoid';

// 8 字符 hex-like ID(避免 / + = 等出现在 data 属性)
const newAid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const TAG_LIST = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'blockquote', 'figcaption',
  'button', 'a', 'input', 'textarea', 'select', 'label',
  'img', 'video', 'audio',
  'section', 'article', 'main', 'aside', 'header', 'footer', 'nav',
];

// 注意:把长名放前(aside/audio 在 a 前),用 \b 兜底以免误匹配 <aside> 为 <a + side>
const TAG_RE = new RegExp(
  // 先匹配长的(>= 4 chars),再短的
  `<(${TAG_LIST
    .slice()
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b([^>]*)>`,
  'gi'
);

const HAS_DATA_AID_RE = /\bdata-aid\s*=/i;

/** 给 HTML 字符串中所有白名单标签注入 data-aid(已有则保留) */
export function injectAids(html: string): string {
  return html.replace(TAG_RE, (full, tag, attrs) => {
    if (HAS_DATA_AID_RE.test(attrs)) return full;
    const id = newAid();
    // 处理自闭合 / 末尾空白
    const trimmed = (attrs as string).replace(/\s+$/, '');
    const trailingSlash = trimmed.endsWith('/') ? ' /' : '';
    const cleanAttrs = trailingSlash
      ? trimmed.slice(0, -1).replace(/\s+$/, '')
      : trimmed;
    const sep = cleanAttrs && !cleanAttrs.startsWith(' ') ? ' ' : '';
    return `<${tag}${sep}${cleanAttrs} data-aid="${id}"${trailingSlash}>`;
  });
}

/**
 * 入口:文件入库前调用。仅对 .html / .htm 起作用。
 * 其他文件(css/js/二进制)直接返回原内容。
 */
export function postProcessOnWrite(path: string, content: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return injectAids(content);
  }
  return content;
}

/** 反向操作:导出"干净版"时 strip 掉所有 data-aid */
export function stripAids(html: string): string {
  return html.replace(/\s+data-aid="[a-z0-9]+"/gi, '');
}
