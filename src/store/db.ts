/* Dexie schema — 见 plan「文件系统」章节
 * 关键设计:messages.blocks 存归一化格式(text/tool_use/tool_result/image),
 * provider 在 LLM 边界 adapt;切 provider 历史可重发
 */

import Dexie, { type EntityTable } from 'dexie';
import type { ProjectBrief, TaskBrief } from './briefs';

// === 归一化消息 block 类型 ===
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | Block[];
      is_error?: boolean;
    }
  | { type: 'image'; source: { mediaType: string; data: string } };

export type MessageKind =
  | 'chat'
  | 'action_batch'
  | 'console_errors'
  | 'summary'
  | 'interrupt_marker';

// === 表实体 ===
export interface Project {
  id?: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 项目级钉板:被钉到 brief 的 message id 数组(注入新 chat 的 system 上下文) */
  pinnedMessageIds?: number[];
  /** v1.7:项目级背景 brief — 跨任务共享。新建项目时引导填写,可日后改 */
  brief?: ProjectBrief | null;
  /** v6.0b:Electron 模式下绑到本地文件夹绝对路径。null = 浏览器虚拟项目(走 IDB)*/
  rootPath?: string | null;
}

export interface Chat {
  id?: number;
  projectId: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** v1.7:任务背景 — 新建任务时引导填写。AI 每次调用都会拿到 */
  task?: TaskBrief | null;
  /** v1.8:本 chat 累计的 console-error 自动修轮数。>= 1 不再静默喂回,改为用户决定 */
  autoFixRetries?: number;
}

export type FileType = 'text' | 'binary';

export interface ProjectFile {
  id?: number;
  projectId: number;
  path: string;            // 相对路径,如 "index.html" 或 "uploads/logo.png"
  type: FileType;
  content: string;         // text 直接存字符串;binary 存 base64(便于导出/读)
  mtime: number;
}

export interface ChatMessage {
  id?: number;
  projectId: number;
  /** v1.6:消息归属哪个 chat 会话(向后兼容,旧数据迁移到默认 chat) */
  chatId: number;
  role: 'user' | 'assistant';
  blocks: Block[];
  kind?: MessageKind;
  turnId?: string;         // 关联 snapshot
  interrupted?: boolean;   // 该 message 被中断了
  createdAt: number;
}

// 文件级 diff:before 为 null = 新建;after 为 null = 删除;否则 = 修改
export interface FileDiff {
  path: string;
  before: { type: FileType; content: string } | null;
  after: { type: FileType; content: string } | null;
}

export interface Snapshot {
  id?: number;
  projectId: number;
  /** v1.6:回滚仍是项目文件级,但记录 snapshot 是哪个 chat 触发的 */
  chatId?: number;
  turnId: string;
  diff: FileDiff[];        // 这一 turn 内所有改过的文件 before/after
  rolledBack?: boolean;    // 已被回滚则不能再次显示按钮
  createdAt: number;
}

export interface SettingsRow {
  id?: number;
  key: string;             // 'provider' | 'model' | 'apiKeyEncrypted' | 'baseUrl' | 'rollbackWarningSeen' | ...
  value: unknown;
}

// === Dexie database ===
// DB 名带 schema 版本后缀。schema 大改时直接换名,旧 DB 留着不管。
// 历史:'ai-design'(v1 dev 各种漂移)→ 'ai-design-app'(被旧 SW bump 到 1000+)→
//      'ai-design-data-v1'(v1.5 后端架构)→ 'ai-design-data-v2'(v1.6 多 chat)
// v1.7:加 Project.brief + Chat.task 字段(都是 JSON,Dexie 不需要建索引,直接 add 字段不影响 schema)
const DB_NAME = 'ai-design-data-v2';
export const DB_VERSION = 1;

class AiDesignDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  chats!: EntityTable<Chat, 'id'>;
  files!: EntityTable<ProjectFile, 'id'>;
  messages!: EntityTable<ChatMessage, 'id'>;
  snapshots!: EntityTable<Snapshot, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      projects: '++id, createdAt, updatedAt',
      chats: '++id, projectId, createdAt, updatedAt',
      files: '++id, projectId, path, [projectId+path], mtime',
      messages:
        '++id, projectId, chatId, createdAt, turnId, [chatId+createdAt]',
      snapshots:
        '++id, projectId, chatId, turnId, [projectId+turnId], createdAt',
      settings: '++id, &key',
    });
  }
}

export const db = new AiDesignDB();

/** 启动时调用:撞 VersionError 自动删 DB 重建,免得用户每次清 site data
 *  生产可加 confirm,dev 直接干 */
export async function ensureDbOpen(): Promise<void> {
  try {
    await db.open();
  } catch (e: any) {
    const isVersionErr =
      e?.name === 'VersionError' ||
      String(e?.message ?? '').includes('VersionError');
    if (!isVersionErr) throw e;
    console.warn(
      `[db] VersionError(本地 DB 比代码版本高):${e.message} — 自动删 DB 重建`
    );
    db.close();
    await Dexie.delete(DB_NAME);
    await db.open();
  }
}
