/* 增量 JSON 解析 — 用于流式渲染 ask_questions tool 的 questions
 *
 * 设计:
 *   - LLM 流式 tool_use 时 args 是逐字符过来的(input_json_delta / function.arguments)
 *   - 等到 final 一次 JSON.parse 才知道有几题 → 用户感受不到 "正在生成第 3 题" 这种动态
 *   - 这里做一个最简的"找到所有完整 {...}"扫描器:每次 buffer 增量后,扫一遍,
 *     提取出 questions 数组里所有目前已经平衡(brace 完整)的对象,逐个 JSON.parse
 *
 * 性能:每次 arg_delta 跑一遍全量 buffer。问题大小 <10KB,O(n) 完全够用
 */

import type { Question } from './questions';

export interface PartialAskQuestionsArgs {
  title: string | null;
  questions: Question[];
}

/** 尝试从部分 JSON 串里解出 title + 已完整的 question 对象列表 */
export function tryParseAskQuestionsPartial(
  buffer: string
): PartialAskQuestionsArgs {
  const out: PartialAskQuestionsArgs = { title: null, questions: [] };
  if (!buffer) return out;

  // 1. 提 title — 找 "title": "..."(完整 string,可能含转义)
  out.title = extractStringField(buffer, 'title');

  // 2. 找 "questions": [
  const m = buffer.match(/"questions"\s*:\s*\[/);
  if (!m || m.index == null) return out;
  let pos = m.index + m[0].length;

  while (pos < buffer.length) {
    // skip whitespace + commas
    while (pos < buffer.length && /[\s,]/.test(buffer[pos])) pos++;
    if (pos >= buffer.length) break;
    if (buffer[pos] === ']') break; // 数组结束
    if (buffer[pos] !== '{') break; // 异常字符,放弃

    // 扫到匹配的 } — 注意字符串里的 } 不算
    const startIdx = pos;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let endIdx = -1;
    for (let i = pos; i < buffer.length; i++) {
      const ch = buffer[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inStr) {
        if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) break; // 这一题还不完整

    const objStr = buffer.slice(startIdx, endIdx + 1);
    try {
      const obj = JSON.parse(objStr);
      // 最低有效性:id + type + label 都有
      if (
        obj &&
        typeof obj.id === 'string' &&
        typeof obj.type === 'string' &&
        typeof obj.label === 'string'
      ) {
        const q = normalizePartialQuestion(obj);
        if (q) out.questions.push(q);
      }
    } catch {
      // 出错说明 JSON 内部还在被 LLM 写,跳过
    }
    pos = endIdx + 1;
  }

  return out;
}

/** 提取 "key": "value" 形式的 string 字段;value 还在写没收尾的 " → 返 null */
function extractStringField(buffer: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = re.exec(buffer);
  if (!m || m.index == null) return null;
  let pos = m.index + m[0].length;
  let val = '';
  let escaped = false;
  while (pos < buffer.length) {
    const ch = buffer[pos++];
    if (escaped) {
      // 简单还原常见转义
      val += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === '"' ? '"' : ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return val;
    val += ch;
  }
  return null; // 收尾 " 还没来
}

/** 把可能不完整的 question 对象规范成 Question 类型;无法识别则返 null */
function normalizePartialQuestion(o: any): Question | null {
  const id = String(o.id ?? '');
  const label = String(o.label ?? '');
  const t = String(o.type ?? '');
  if (!id || !label) return null;
  if (t === 'text') {
    return {
      type: 'text',
      id,
      label,
      hint: o.hint,
      placeholder: o.placeholder,
      multiline: !!o.multiline,
      decideForMe: o.decideForMe,
    };
  }
  if (t === 'single' || t === 'multi') {
    const options = Array.isArray(o.options)
      ? o.options
          .filter((x: any) => x && x.label && x.value != null)
          .map((x: any) => ({ label: String(x.label), value: String(x.value) }))
      : [];
    return {
      type: t,
      id,
      label,
      hint: o.hint,
      options,
      allowOther: !!o.allowOther,
      decideForMe: o.decideForMe,
    } as Question;
  }
  if (t === 'slider') {
    return {
      type: 'slider',
      id,
      label,
      hint: o.hint,
      min: Number(o.min ?? 1),
      max: Number(o.max ?? 5),
      step: Number(o.step ?? 1),
      default: Number(o.default ?? o.min ?? 1),
      decideForMe: o.decideForMe,
    };
  }
  return null;
}
