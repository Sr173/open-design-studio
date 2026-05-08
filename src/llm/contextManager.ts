/* 上下文管理 — token-based summarize
 *
 * 见 plan critical fix #A:不是 count-based,是 token-based。
 * 用 char-count / 3 估算(粗略,中文偏紧、英文偏松,但作为门槛足够)。
 * 真要更精准可后续接 gpt-tokenizer / tiktoken-wasm,那是优化。
 *
 * 触发:总 token 超过 150k 才 summarize 旧消息(留 50k 给响应)
 */

import type { Block } from '../store/db';
import type { ProviderMessage } from './provider';

const TOKEN_THRESHOLD = 150_000;
const TOKEN_PER_CHAR = 1 / 3;   // 粗略估算

export function estimateBlocksTokens(blocks: Block[]): number {
  let chars = 0;
  for (const b of blocks) {
    if (b.type === 'text') chars += b.text.length;
    else if (b.type === 'tool_use') chars += JSON.stringify(b.input).length + b.name.length + 32;
    else if (b.type === 'tool_result') {
      chars +=
        typeof b.content === 'string'
          ? b.content.length
          : estimateBlocksTokens(b.content as Block[]) / TOKEN_PER_CHAR;
    } else if (b.type === 'image') {
      // 图大致按 1500 token 估
      return 1500;
    }
  }
  return Math.ceil(chars * TOKEN_PER_CHAR);
}

export function estimateMessagesTokens(messages: ProviderMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateBlocksTokens(m.blocks) + 8;
  return total;
}

/**
 * 如果总 token 超过门槛,把前 ~80% 旧消息合并成一条 summary user message。
 * summary 通过 callback 异步生成(由 chat.ts 用同一个 LLM 跑一次)。
 *
 * 返回新的 messages 数组(若没触发则返回原数组引用)。
 */
export interface SummarizeOpts {
  threshold?: number;
  /** 给定要被压的旧 messages,返回压缩后的文本 */
  summarize: (oldMessages: ProviderMessage[]) => Promise<string>;
}

export async function maybeSummarize(
  messages: ProviderMessage[],
  opts: SummarizeOpts
): Promise<ProviderMessage[]> {
  const threshold = opts.threshold ?? TOKEN_THRESHOLD;
  const total = estimateMessagesTokens(messages);
  if (total <= threshold) return messages;

  // 取最近 20% 不动,前 80% 压缩
  const splitIdx = Math.floor(messages.length * 0.8);
  if (splitIdx <= 1) return messages; // 太短没法压

  const old = messages.slice(0, splitIdx);
  const recent = messages.slice(splitIdx);

  let summaryText = '';
  try {
    summaryText = await opts.summarize(old);
  } catch (e) {
    console.warn('[contextManager] summarize failed; keeping all messages', e);
    return messages;
  }

  const summaryMsg: ProviderMessage = {
    role: 'user',
    blocks: [
      {
        type: 'text',
        text: `[历史摘要 — 早期对话已被压缩]\n${summaryText}`,
      },
    ],
  };
  return [summaryMsg, ...recent];
}

export function buildSummarizePrompt(): string {
  return `你正在总结一段设计师与 AI 的工作对话。把以下对话压成不超过 500 字的工作上下文,保留:
- 关键产品决策(为谁、做什么、范围)
- 用户偏好(美学锚点、参考产品、避雷点)
- 当前文件结构概况
- 未解决的问题 / 用户没拍板的选择

不要保留:寒暄、已完成且确定的细节、工具调用日志、错误回滚痕迹。
直接输出摘要文本,不要前缀。`;
}
