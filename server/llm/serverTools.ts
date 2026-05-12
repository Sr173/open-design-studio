/* Server-managed tools — 客户端拿不到 result 真内容
 *
 * 这些工具:
 *   1. 客户端 ALL_TOOLS 不注册 → client tool 循环里没人执行
 *   2. server 在 /api/llm/chat 调 LLM 时把它们 merge 进 tools 数组
 *   3. server 自己跑 tool execute,得到 result 注入 messages 继续调 LLM
 *   4. 透传给 client 的 final blocks 里,这些工具的 tool_result.content 被替换成 placeholder
 *   5. 下次 client 把这些 placeholder messages 回传时,server 重建真内容再发给 LLM
 */

import type { Block, ChatToolDef } from './types.js';
import { readSkillSection, listSkillSections } from '../skill-chapters.js';

export const SERVER_TOOLS: ChatToolDef[] = [
  {
    name: 'read_skill',
    description:
      '按需读 design-work skill 的章节(常驻 system 只载入精简 core,详细章节用此工具拉)。' +
      '\n\n可用 section:\n' +
      '  - "detectors" — 全部 D1-D16 自检规则\n' +
      '  - "multi-variant" — 风险梯度 / 变化轴 / 承载方式 / shared 纪律 / 重组协议 / 锁定 / 子变体\n' +
      '  - "aesthetic" — 字体配对 / 装饰原子 / 不要默认 SaaS / 完整 vocabulary\n' +
      '  - "tweaks" — Tweak marker 三种语法 + 适用类型\n' +
      '  - "phase-1" ~ "phase-8" — 单 phase 详细要求\n' +
      '\n**不要无目的调用** — 只在你即将执行某动作且需要章节细节时拉。',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: '章节 id' },
      },
      required: ['section'],
    },
  },
];

export const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.name));

/** server 端工具执行 — 返回真实内容(给 LLM)+ placeholder(给 client) */
export interface ServerToolExec {
  realContent: string;
  placeholderContent: string;
  isError?: boolean;
}

export function execServerTool(
  name: string,
  input: unknown
): ServerToolExec {
  if (name === 'read_skill') {
    const section = String((input as any)?.section ?? '').trim();
    if (!section) {
      return {
        realContent: 'section 参数缺失',
        placeholderContent: '[read_skill: 参数错误]',
        isError: true,
      };
    }
    const body = readSkillSection(section);
    if (!body) {
      const available = listSkillSections().join(', ');
      return {
        realContent: `unknown section "${section}". Available: ${available}`,
        placeholderContent: `[read_skill: 未知 section "${section}"]`,
        isError: true,
      };
    }
    return {
      realContent: body,
      placeholderContent: `[read_skill section="${section}" loaded server-side, ${body.length} chars — content stays on server]`,
    };
  }
  return {
    realContent: `unknown server tool: ${name}`,
    placeholderContent: `[unknown server tool: ${name}]`,
    isError: true,
  };
}

/** 用占位 result 替换 final blocks 里 server-managed tool 的真内容 */
export function maskServerToolResultsInBlocks(blocks: Block[]): Block[] {
  // tool_use 直接保留(client 看到 AI 调了什么),tool_result 在另一条 user message
  // 这里只处理 tool_result 本身(server inner loop 加的)
  return blocks;
}

/** 入 LLM 前重建:把 client 传来的 messages 里 server-tool 的 placeholder 还原成真内容 */
export function rehydrateServerToolResults(
  messages: Array<{ role: 'user' | 'assistant'; blocks: Block[] }>
): Array<{ role: 'user' | 'assistant'; blocks: Block[] }> {
  // 收集所有 assistant 历史里 server-managed 工具调用:tool_use_id → input
  const serverToolUses = new Map<string, { name: string; input: any }>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const b of m.blocks) {
      if (b.type === 'tool_use' && SERVER_TOOL_NAMES.has(b.name)) {
        serverToolUses.set(b.id, { name: b.name, input: b.input });
      }
    }
  }
  if (serverToolUses.size === 0) return messages;

  // 重建 tool_result.content:用真内容替换 placeholder
  return messages.map((m) => {
    if (m.role !== 'user') return m;
    let touched = false;
    const next = m.blocks.map((b) => {
      if (b.type !== 'tool_result') return b;
      const use = serverToolUses.get(b.tool_use_id);
      if (!use) return b;
      // 这条 tool_result 是 server-managed,重跑 execute 拿真内容
      const r = execServerTool(use.name, use.input);
      touched = true;
      return {
        ...b,
        content: r.realContent,
        is_error: r.isError,
      };
    });
    return touched ? { ...m, blocks: next } : m;
  });
}
