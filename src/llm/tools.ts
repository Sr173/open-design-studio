/* v1 工具定义 + 执行器
 *
 * 6 个最小工具,见 plan「工具集」表
 *   - write_file 入库前调 postProcess(自动注入 data-aid)
 *   - 串行执行,每个 IO 边界 check abort
 */

import type { ChatToolDef } from './provider';
import {
  writeFile,
  readFile,
  listFiles,
  deleteFiles,
  isValidPath,
  sliceContent,
} from '../store/files';
import { postProcessOnWrite } from '../preview/postProcess';
import { lookupElement, writeBack } from '../inspect/inlineEdit';
import type { QuestionSet, Question } from './questions';
import {
  lintAskQuestions,
  lintWriteFile,
  lintVariantCommentary,
  lintVariantSlug,
  lintVariantProliferation,
  lintRiskGradientAcrossVariants,
} from './detectors';

export interface ToolExecCtx {
  projectId: number;
  signal: AbortSignal;
  /** 当前 tool 写入的文件名(给 PreviewPane writing 蒙层显示)*/
  onWriteStart?: (path: string) => void;
  /** done 工具触发的回调(让 chat.ts 准备查 console errors) */
  onDone?: (summary: string) => void;
  /** show_to_user 触发(切预览到指定路径)*/
  onShow?: (path: string) => void;
  /** ask_questions 触发:把问卷推上 UI,等用户提交 */
  onAskQuestions?: (set: QuestionSet, toolUseId: string) => void;
  /** 当前 tool_use_id (Anthropic) — 让 ask_questions 能拿到 */
  toolUseId?: string;
}

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

// v1.8 后:read_skill 改为 server-managed 工具,前端不再注册。
// LLM 看到 read_skill(server 在调用 LLM 时把它注入 tools 数组),
// 但 client 拿不到章节内容(server 内部循环跑,tool_result 透传给 client 时已脱敏)
export const META_TOOLS: ChatToolDef[] = [];

export const QUESTION_TOOLS: ChatToolDef[] = [
  {
    name: 'ask_questions',
    description:
      '把一组问题渲染成结构化表单(chip / 滑块 / 输入框)推到中间 Questions tab。' +
      '用户填完提交后会作为下一条 user message 回来。' +
      '\n\n**调用此工具之前必须先在 chat 输出 SKILL.md Artifact 1 (Recon 块) + Artifact 2 (Pre-question brief)**。' +
      '没有这两块直接调 ask_questions 等于跳过了 Phase 1。' +
      '\n\n用法时机:Phase 2 — 在动手写文件前,把"业务先 → 约束次 → 美学最后"的问题攒成一组(3–6 题)发出来。' +
      '比 markdown 列文字问题强 100 倍。' +
      '\n\n美学题尽量用 single/multi chip 配参考产品名;让用户点而不是描述。' +
      '每题给 decideForMe(默认值)兜底,用户可跳过。' +
      '调完这个工具就结束本轮(不要再调 done),等用户提交。',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '问卷标题,如 "关于产品落地页的几个问题"',
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '稳定 ID,英文 slug,如 "product"' },
              type: {
                type: 'string',
                enum: ['text', 'single', 'multi', 'slider'],
              },
              label: { type: 'string' },
              hint: { type: 'string', description: '副标题,解释为什么问' },
              decideForMe: {
                type: 'string',
                description: '用户跳过时你的默认值;UI 显示 "Decide for me" 按钮',
              },
              placeholder: { type: 'string', description: 'text 类型用' },
              multiline: { type: 'boolean', description: 'text 是否多行' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['label', 'value'],
                },
                description: 'single/multi 选项',
              },
              allowOther: {
                type: 'boolean',
                description: '是否允许"Other..."自定义输入',
              },
              min: { type: 'number', description: 'slider' },
              max: { type: 'number', description: 'slider' },
              step: { type: 'number', description: 'slider' },
              default: { type: 'number', description: 'slider' },
            },
            required: ['id', 'type', 'label'],
          },
        },
      },
      required: ['title', 'questions'],
    },
  },
];

export const V2_TOOLS: ChatToolDef[] = [
  {
    name: 'get_element_info',
    description:
      '按 data-aid 查找元素,返回所在文件路径、标签名、文本预览、源码 80 字邻域。' +
      '用户消息出现 [选中 #aid-xxx] 时,可以用这个工具拿元素详情再回应。',
    input_schema: {
      type: 'object',
      properties: {
        aid: { type: 'string' },
      },
      required: ['aid'],
    },
  },
  {
    name: 'replace_element_text',
    description:
      '按 data-aid 改某个 HTML 元素的 textContent,源码自动回写。仅适用于 single-text-node 元素。' +
      '不要用这个工具改 img / input 等无 textContent 的标签。',
    input_schema: {
      type: 'object',
      properties: {
        aid: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['aid', 'text'],
    },
  },
];

export const V1_TOOLS: ChatToolDef[] = [
  {
    name: 'write_file',
    description:
      '创建或覆盖一个项目文件(整文件写)。HTML/CSS/JS 内容会被持久化,SW 在预览 iframe 里直接 serve。' +
      '若该文件已存在则覆盖。HTML 文件入库前会自动注入 data-aid 元素 ID,你不需要手写。' +
      '\n\n**选择 write_file vs edit_file**:' +
      '\n- 新文件 / 大改(>40% 内容) → write_file' +
      '\n- 小改(改 1 行 CSS 变量、改一段文案、加一个 class) → 用 edit_file 省 token',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对路径,如 "index.html" 或 "styles/main.css"',
        },
        content: { type: 'string', description: '文件全文' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      '在已存在的文件里做精确字符串替换 — 改一两处的首选,比 write_file 整文件重写省 90% token。' +
      '\n\n规则:' +
      '\n- old_string 必须**逐字符精确**出现在文件里(含缩进、空格、换行)' +
      '\n- 默认 old_string 在文件中**必须唯一**;不唯一时:① 扩展 old_string 包更多上下文使其唯一,或 ② 显式传 replace_all=true 一次性替换全部' +
      '\n- new_string 不能等于 old_string(那是 no-op,会被拒)' +
      '\n- HTML 文件改完仍会跑 data-aid 自动注入 — 不要在 old_string / new_string 里手写 data-aid' +
      '\n- 文件不存在 → 用 write_file 而不是 edit_file' +
      '\n\n典型用法:' +
      '\n- 改一行 CSS 变量 → old="--brand: #ff8800;" new="--brand: #1e3a8a;"' +
      '\n- 改一段文案 → old="立即注册" new="开始试用"' +
      '\n- 改一个 class → old=\'class="btn-primary"\' new=\'class="btn-primary btn-lg"\'',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对路径' },
        old_string: {
          type: 'string',
          description: '要被替换的精确文本(逐字符匹配)',
        },
        new_string: {
          type: 'string',
          description: '替换后的文本',
        },
        replace_all: {
          type: 'boolean',
          description: '默认 false(要求唯一匹配);true 时替换所有出现',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'read_file',
    description:
      '读取项目内的一个文件。二进制文件(图片等)只返回 metadata,不返回字节。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number', description: '起始行,可选' },
        limit: { type: 'number', description: '读取行数上限,可选' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: '列出项目所有文件路径(扁平列表)。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'delete_file',
    description: '删除一个或多个文件。',
    input_schema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'show_to_user',
    description: '把指定文件设为预览面板入口(默认 index.html)。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'done',
    description:
      '宣告本轮工作完成,把控制权还给用户。summary 是一两句话概括做了什么,会在 chat 显示。',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
  },
];

export const ALL_TOOLS: ChatToolDef[] = [
  ...V1_TOOLS,
  ...V2_TOOLS,
  ...QUESTION_TOOLS,
  ...META_TOOLS,
];

export async function executeTool(
  name: string,
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  if (ctx.signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  switch (name) {
    case 'write_file':
      return execWriteFile(input, ctx);
    case 'edit_file':
      return execEditFile(input, ctx);
    case 'read_file':
      return execReadFile(input, ctx);
    case 'list_files':
      return execListFiles(ctx);
    case 'delete_file':
      return execDeleteFile(input, ctx);
    case 'show_to_user':
      return execShowToUser(input, ctx);
    case 'done':
      return execDone(input, ctx);
    case 'get_element_info':
      return execGetElementInfo(input, ctx);
    case 'replace_element_text':
      return execReplaceElementText(input, ctx);
    case 'ask_questions':
      return execAskQuestions(input, ctx);
    default:
      return {
        content: `Unknown tool: ${name}`,
        is_error: true,
      };
  }
}

async function execWriteFile(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const path = String(input?.path ?? '');
  const content = String(input?.content ?? '');
  if (!isValidPath(path)) {
    return { content: `路径不合法: ${path}`, is_error: true };
  }

  // === Detector lint(代码级,失败直接返 is_error,LLM 自动重试)===
  const lintSlug = lintVariantSlug(path);
  if (!lintSlug.ok) return { content: lintSlug.reason, is_error: true };

  const lintProlif = await lintVariantProliferation(ctx.projectId, path);
  if (!lintProlif.ok) return { content: lintProlif.reason, is_error: true };

  const lintShared = await lintWriteFile(ctx.projectId, path);
  if (!lintShared.ok) return { content: lintShared.reason, is_error: true };

  const lintCommentary = lintVariantCommentary(path, content);
  if (!lintCommentary.ok)
    return { content: lintCommentary.reason, is_error: true };

  ctx.onWriteStart?.(path);
  const processed = postProcessOnWrite(path, content);
  await writeFile(ctx.projectId, path, processed, 'text', 'ai');
  return {
    content: `wrote ${path} (${processed.length} chars${
      processed.length !== content.length
        ? `, +${processed.length - content.length} from data-aid injection`
        : ''
    })`,
  };
}

async function execEditFile(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const path = String(input?.path ?? '');
  const oldStr = String(input?.old_string ?? '');
  const newStr = String(input?.new_string ?? '');
  const replaceAll = !!input?.replace_all;

  if (!isValidPath(path)) {
    return { content: `路径不合法: ${path}`, is_error: true };
  }
  if (!oldStr) {
    return { content: 'old_string 不能为空', is_error: true };
  }
  if (oldStr === newStr) {
    return {
      content: 'old_string 等于 new_string,no-op 被拒(没有实际修改)',
      is_error: true,
    };
  }

  const existing = await readFile(ctx.projectId, path);
  if (!existing) {
    return {
      content: `文件不存在: ${path}。新建文件请用 write_file。`,
      is_error: true,
    };
  }
  if (existing.type === 'binary') {
    return {
      content: `不能 edit 二进制文件: ${path}`,
      is_error: true,
    };
  }

  // 匹配检查
  const occurrences = countOccurrences(existing.content, oldStr);
  if (occurrences === 0) {
    return {
      content:
        `old_string 在 ${path} 里没找到。常见原因:` +
        `① 缩进/空格不对(逐字符精确匹配,含 tab/space 类型);` +
        `② 你记的内容跟实际文件有出入,先 read_file 确认一下;` +
        `③ 行尾差异(\\n vs \\r\\n)`,
      is_error: true,
    };
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      content:
        `old_string 在 ${path} 里出现了 ${occurrences} 次,匹配不唯一。` +
        `要么扩展 old_string 包更多上下文让它唯一,要么传 replace_all=true 一次替换全部。`,
      is_error: true,
    };
  }

  // 执行替换
  let nextContent: string;
  if (replaceAll) {
    nextContent = splitAndJoin(existing.content, oldStr, newStr);
  } else {
    const idx = existing.content.indexOf(oldStr);
    nextContent =
      existing.content.slice(0, idx) +
      newStr +
      existing.content.slice(idx + oldStr.length);
  }

  // === Detector lint(跟 write_file 一致;edit 也可能引入 commentary 等问题)===
  const lintCommentary = lintVariantCommentary(path, nextContent);
  if (!lintCommentary.ok)
    return { content: lintCommentary.reason, is_error: true };

  ctx.onWriteStart?.(path);
  const processed = postProcessOnWrite(path, nextContent);
  await writeFile(ctx.projectId, path, processed, 'text', 'ai');

  const replacedCount = replaceAll ? occurrences : 1;
  const sizeDiff = processed.length - existing.content.length;
  return {
    content:
      `edited ${path} (${replacedCount} replacement${replacedCount > 1 ? 's' : ''}, ` +
      `${sizeDiff >= 0 ? '+' : ''}${sizeDiff} chars)`,
  };
}

/** 计算 needle 在 hay 中的出现次数(不重叠) */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = hay.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/** 全量替换 — split/join 避免 regex 特殊字符问题 */
function splitAndJoin(hay: string, needle: string, replacement: string): string {
  return hay.split(needle).join(replacement);
}

async function execReadFile(input: any, ctx: ToolExecCtx): Promise<ToolResult> {
  const path = String(input?.path ?? '');
  const offset =
    typeof input?.offset === 'number' ? input.offset : undefined;
  const limit = typeof input?.limit === 'number' ? input.limit : undefined;
  if (!isValidPath(path)) {
    return { content: `路径不合法: ${path}`, is_error: true };
  }
  const f = await readFile(ctx.projectId, path);
  if (!f) return { content: `not found: ${path}`, is_error: true };
  if (f.type === 'binary') {
    return {
      content: `<binary file: ${Math.round(
        (f.content.length * 0.75) / 1024
      )}KB ${path.split('.').pop()}>`,
    };
  }
  return { content: sliceContent(f.content, offset, limit) };
}

async function execListFiles(ctx: ToolExecCtx): Promise<ToolResult> {
  const files = await listFiles(ctx.projectId);
  if (files.length === 0) return { content: '(empty project)' };
  return {
    content: files
      .map((f) => `${f.path} ${f.type === 'binary' ? '[binary]' : ''}`.trim())
      .join('\n'),
  };
}

async function execDeleteFile(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const paths = Array.isArray(input?.paths) ? input.paths.map(String) : [];
  if (paths.some((p: string) => !isValidPath(p))) {
    return { content: '存在不合法路径', is_error: true };
  }
  await deleteFiles(ctx.projectId, paths, 'ai');
  return { content: `deleted: ${paths.join(', ')}` };
}

async function execShowToUser(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const path = String(input?.path ?? 'index.html');
  ctx.onShow?.(path);
  return { content: `now showing ${path}` };
}

async function execDone(input: any, ctx: ToolExecCtx): Promise<ToolResult> {
  const summary = String(input?.summary ?? '');

  // D11 跨 variant 风险梯度检查 — 在宣告完成前最后一道闸
  const gradient = await lintRiskGradientAcrossVariants(ctx.projectId);
  if (!gradient.ok) {
    return { content: gradient.reason, is_error: true };
  }

  ctx.onDone?.(summary);
  return { content: `done: ${summary}` };
}

async function execGetElementInfo(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const aid = String(input?.aid ?? '').trim();
  if (!aid) return { content: 'aid 不能为空', is_error: true };
  const info = await lookupElement(ctx.projectId, aid);
  if (!info) return { content: `aid not found: ${aid}`, is_error: true };
  return {
    content: [
      `path: ${info.path}`,
      `tag: ${info.tag}`,
      `text: ${info.textPreview}`,
      `snippet:`,
      info.outerSnippet,
    ].join('\n'),
  };
}

async function execReplaceElementText(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const aid = String(input?.aid ?? '').trim();
  const text = String(input?.text ?? '');
  if (!aid) return { content: 'aid 不能为空', is_error: true };
  ctx.onWriteStart?.(`[edit ${aid}]`);
  const r = await writeBack(ctx.projectId, aid, text, 'ai');
  if (!r.found) return { content: `aid not found: ${aid}`, is_error: true };
  return { content: `replaced text in ${r.path} for #${aid}` };
}

async function execAskQuestions(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const title = String(input?.title ?? '请回答以下问题');
  const rawQs = Array.isArray(input?.questions) ? input.questions : [];
  const questions: Question[] = [];
  for (const q of rawQs) {
    if (!q || typeof q !== 'object') continue;
    const id = String(q.id ?? '').trim();
    const label = String(q.label ?? '').trim();
    if (!id || !label) continue;
    const t = String(q.type ?? '');
    if (t === 'text') {
      questions.push({
        type: 'text',
        id,
        label,
        hint: q.hint,
        placeholder: q.placeholder,
        multiline: !!q.multiline,
        decideForMe: q.decideForMe,
      });
    } else if (t === 'single' || t === 'multi') {
      const options = Array.isArray(q.options)
        ? q.options
            .filter((o: any) => o && o.label && o.value != null)
            .map((o: any) => ({ label: String(o.label), value: String(o.value) }))
        : [];
      if (options.length === 0) continue;
      questions.push({
        type: t,
        id,
        label,
        hint: q.hint,
        options,
        allowOther: !!q.allowOther,
        decideForMe: q.decideForMe,
      } as Question);
    } else if (t === 'slider') {
      questions.push({
        type: 'slider',
        id,
        label,
        hint: q.hint,
        min: Number(q.min ?? 1),
        max: Number(q.max ?? 5),
        step: Number(q.step ?? 1),
        default: Number(q.default ?? q.min ?? 1),
        decideForMe: q.decideForMe,
      });
    }
  }
  if (questions.length === 0) {
    return { content: '没有有效问题(每题需 id/label/type)', is_error: true };
  }

  // === D1 lint ===
  const lint = lintAskQuestions({ title, questions });
  if (!lint.ok) return { content: lint.reason, is_error: true };

  const set: QuestionSet = {
    title,
    questions,
    toolUseId: ctx.toolUseId,
  };
  ctx.onAskQuestions?.(set, ctx.toolUseId ?? '');
  return {
    content: `[问卷已推到 Questions tab,${questions.length} 题。等用户提交后会作为下一条 user message 回来。本轮请直接结束,不要再调其它工具。]`,
  };
}
