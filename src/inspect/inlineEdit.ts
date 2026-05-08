/* inline 编辑 → 源码回写
 *
 * 用户在 iframe 改了某个 data-aid 元素的 textContent → blur 时 inject.js 发 inline_edit 消息
 * → 这里订阅,grep 所有项目文件找 data-aid="<aid>" 的标签,用 DOMParser 重写 textContent
 *
 * 边界(plan critical fix #3):仅 single-text-node 元素允许 contentEditable —— iframe inject.js
 * 已经过滤,不可改的根本不会触发 blur。所以这里不需要再做安全判断。
 */

import { onPreviewMessage } from '../preview/sandboxBridge';
import {
  listFiles,
  writeFile,
  isValidPath,
} from '../store/files';

let installedFor = new Set<number>();

export function installInlineEdit(projectId: number): () => void {
  if (installedFor.has(projectId)) return () => {};
  installedFor.add(projectId);

  const unsub = onPreviewMessage(projectId, async (msg) => {
    if (msg.type !== 'inline_edit') return;
    try {
      await writeBack(projectId, msg.aid, msg.after, 'user');
    } catch (e) {
      console.error('[inlineEdit] writeBack failed', e);
    }
  });

  return () => {
    installedFor.delete(projectId);
    unsub();
  };
}

/** 给一个 aid 把对应元素的 textContent 改成 newText,源码就近回写 */
export async function writeBack(
  projectId: number,
  aid: string,
  after: string,
  source: 'user' | 'ai' = 'user'
): Promise<{ found: boolean; path?: string }> {
  const files = await listFiles(projectId);
  for (const f of files) {
    if (f.type !== 'text') continue;
    const lower = f.path.toLowerCase();
    if (!lower.endsWith('.html') && !lower.endsWith('.htm')) continue;
    if (!isValidPath(f.path)) continue;

    const aidRe = new RegExp(`\\bdata-aid=["']${escapeRegex(aid)}["']`);
    if (!aidRe.test(f.content)) continue;

    const next = replaceTextContent(f.content, aid, after);
    if (next !== f.content) {
      await writeFile(projectId, f.path, next, 'text', source);
    }
    return { found: true, path: f.path };
  }
  return { found: false };
}

/** 在 HTML 文件里按 aid 找元素并提取信息(给 get_element_info 工具用)*/
export async function lookupElement(
  projectId: number,
  aid: string
): Promise<{
  path: string;
  tag: string;
  textPreview: string;
  outerSnippet: string;
} | null> {
  const files = await listFiles(projectId);
  for (const f of files) {
    if (f.type !== 'text') continue;
    const lower = f.path.toLowerCase();
    if (!lower.endsWith('.html') && !lower.endsWith('.htm')) continue;
    const re = new RegExp(
      `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-aid=["']${escapeRegex(
        aid
      )}["'][^>]*>([\\s\\S]*?)</\\1>`,
      'i'
    );
    const m = re.exec(f.content);
    if (m) {
      const tag = m[1].toLowerCase();
      const inner = m[2];
      const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const start = Math.max(0, m.index - 80);
      const end = Math.min(f.content.length, m.index + m[0].length + 80);
      return {
        path: f.path,
        tag,
        textPreview: text.slice(0, 200),
        outerSnippet: f.content.slice(start, end),
      };
    }
    // 自闭合 / void(<img data-aid=...>)
    const voidRe = new RegExp(
      `<(img|input|area|br|col|embed|hr|link|meta|source|track|wbr)\\b[^>]*\\bdata-aid=["']${escapeRegex(
        aid
      )}["'][^>]*/?>`,
      'i'
    );
    const v = voidRe.exec(f.content);
    if (v) {
      return {
        path: f.path,
        tag: v[1].toLowerCase(),
        textPreview: '',
        outerSnippet: v[0],
      };
    }
  }
  return null;
}

async function _legacyWriteBack(projectId: number, aid: string, after: string) {
  await writeBack(projectId, aid, after, 'user');
}

/** 用正则按 data-aid 找开标签,匹配到对应闭标签,替换中间 textContent */
function replaceTextContent(html: string, aid: string, newText: string): string {
  // 找到带 data-aid 的开标签
  const openRe = new RegExp(
    `(<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-aid=["']${escapeRegex(
      aid
    )}["'][^>]*>)`,
    ''
  );
  const m = openRe.exec(html);
  if (!m) return html;

  const tag = m[2].toLowerCase();
  const openEnd = m.index + m[1].length;

  // 自闭合标签(img/input 等)无 textContent
  if (isVoidTag(tag)) return html;

  // 找对应 </tag>(简单匹配,不处理同名嵌套 — single-text-node 不会嵌套同名)
  const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
  const closeMatch = closeRe.exec(html.slice(openEnd));
  if (!closeMatch) return html;
  const closeStart = openEnd + closeMatch.index;

  // 旧内容(text node only,inject.js 已经保证)
  // 把内部完全替换成新文本(escape HTML 特殊字符)
  const escaped = escapeHtml(newText);
  return html.slice(0, openEnd) + escaped + html.slice(closeStart);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isVoidTag(tag: string): boolean {
  return [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ].includes(tag);
}
