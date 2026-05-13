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
  formatFileForLLM,
  clampForRead,
  READ_LINES_DEFAULT,
} from '../store/files';
import { postProcessOnWrite } from '../preview/postProcess';
import { lookupElement, writeBack } from '../inspect/inlineEdit';
import type { QuestionSet, Question } from './questions';
import { db } from '../store/db';
import { native, isElectron } from '../native';
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
  /** todo_write 触发:替换当前 todo 列表 */
  onTodoUpdate?: (todos: Array<{ id: string; content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }>) => void;
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

// === v6.0g 新增:源码只读工具(仅 Electron + native 项目可用)===
// 让 AI 在设计前能看一眼用户的项目代码(package.json / README / 现有组件 / 设计系统等),
// 但**不能写**到 .design/ 之外
export const PLAN_TOOLS: ChatToolDef[] = [
  {
    name: 'todo_write',
    description:
      '【任务跟踪】维护当前 chat 的多步任务清单,展示在 chat dock 顶部固定 panel。' +
      '\n\n**何时用**:' +
      '\n  - 用户请求需要 ≥3 个明确步骤 → 一开始 todo_write 全列出来(全 pending)' +
      '\n  - 开始做某一项 → 把那项 status 改 in_progress(同一时刻只一个 in_progress)' +
      '\n  - 做完一项 → 立即 completed,不要 batch 到最后一起改' +
      '\n  - 单步任务 / 闲聊 / 概念问题 → 不需要 todo,别画蛇添足' +
      '\n\n**调用方式**:每次传入完整 todos 列表(替换式,不是 patch):' +
      '\n  - 加新项:append 到数组末尾,status: "pending"' +
      '\n  - 改状态:用同 id 重传,改 status' +
      '\n  - 删项:从数组中去掉,不传' +
      '\n\n**两种文案表述**(必填,Claude Code 同款):' +
      '\n  - content: 命令式("修复登录 bug" / "运行测试")— 列表展示' +
      '\n  - activeForm: 进行时("修复登录 bug 中" / "运行测试中")— in_progress 时高亮' +
      '\n\n**纪律**:' +
      '\n  - 同时只能有**一个** in_progress(violates → 用户看不出你专注在哪)' +
      '\n  - 任务真做完才标 completed;部分完成 / 遇到 blocker → 保留 in_progress,新加任务描述 blocker' +
      '\n  - 测试还没过 / 实现部分 / 还没找到关键文件 → 都不算 completed',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '稳定 id (如 "fix-login")' },
              content: { type: 'string', description: '命令式表述' },
              activeForm: { type: 'string', description: '进行时表述' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
            required: ['content', 'activeForm', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
];

export const SEARCH_TOOLS: ChatToolDef[] = [
  {
    name: 'search_files',
    description:
      '【grep + glob】跨 .design/ 和源码做正则搜索,返每个命中的 path:line + ±N 行 context。' +
      '\n\n比 list_source_files + read_source_file 串行翻文件**快 10×**,你想找:' +
      '\n  - "这个项目有没有用 zustand?"           → pattern="zustand", scope="source"' +
      '\n  - "之前那个 hero 组件叫啥来着?"          → pattern="hero", scope="design"' +
      '\n  - "导航栏在哪定义的?"                    → pattern="<nav", glob="**/*.tsx", scope="source"' +
      '\n  - "我那个 brand-primary token 用没用?"   → pattern="brand-primary", scope="both"' +
      '\n\n参数细节:' +
      '\n  - **pattern** 是 JavaScript regex(语法错就自动 fallback 成 plain substring,放心写)' +
      '\n  - **glob** 限制扫的文件路径,支持 `**` `*` `?`,例 "src/**/*.{ts,tsx}" / "shared/*.css"' +
      '\n  - **scope** = `design`(只 .design/)| `source`(只项目源码)| `both`(并集)' +
      '\n  - **caseSensitive** 默认 false(`/i` flag)' +
      '\n  - **maxResults** 默认 50,硬上限 200。**首搜先用 50**;命中多就用 glob 缩范围,别盲目调到 200' +
      '\n  - **contextLines** 默认 2,上下各 2 行。一般够用,需要"看更多"用 read_file 翻具体文件更省 token' +
      '\n\n返回 hits[] 每条:' +
      '\n  - path 带前缀:`.design/foo.html` 或 `src/foo.ts`(可直接 feed 进 read_file/read_source_file)' +
      '\n  - line 是 1-indexed' +
      '\n  - 命中行 + 上下 context;patternMode="plain" 提示你正则失败 fallback 了',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '正则模式;失败 fallback 为 substring',
        },
        glob: {
          type: 'string',
          description: '路径过滤(可选),例 "src/**/*.tsx"',
        },
        scope: {
          type: 'string',
          enum: ['design', 'source', 'both'],
          description: '搜索范围;默认 both',
        },
        caseSensitive: { type: 'boolean', description: '默认 false' },
        maxResults: { type: 'number', description: '默认 50,硬上限 200' },
        contextLines: { type: 'number', description: '上下各几行 context,默认 2' },
      },
      required: ['pattern'],
    },
  },
];

export const SOURCE_TOOLS: ChatToolDef[] = [
  {
    name: 'list_source_files',
    description:
      '【只读】列出用户原项目某一**层**目录(非递归,像 shell `ls`),不进 .design/。' +
      '\n\n**像 ls 那样用 — 调用一次只看一层,需要深入就传 path 再调一次**' +
      '\n\n自动应用三层过滤:' +
      '\n  1. 如果是 git 仓库 → 只显示 git 跟踪 / 未被 .gitignore 的文件(最精准)' +
      '\n  2. 否则 → 跳过黑名单(node_modules / .git / dist / .next / .design 等)' +
      '\n  3. 每次调用 cap 在 200 条(单目录文件再多也不爆)' +
      '\n\n**典型用法**(Phase 1 Recon):' +
      '\n  list_source_files()                  → 看根目录:package.json / README.md / src/ ...' +
      '\n  list_source_files({path: "src"})     → 看 src/ 一层:components/ / styles/ / pages/ ...' +
      '\n  list_source_files({path: "src/styles"}) → 看具体的 design tokens 文件名' +
      '\n\n返回:{entries: [{path, kind: "file"|"dir", type, size}], gitMode, truncated}' +
      '\n  - kind="dir" 的 entry 用同名 path 再调本工具就能下钻' +
      '\n  - gitMode=true 表示这是个 git 仓库,你看到的是 git 维度的文件' +
      '\n  - truncated=true 表示这一层超 200 项被截断 — 这种目录通常没设计价值,不用追究',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            '子目录(可选,留空 = 根目录)。例:"src" / "src/components" / "packages/ui/src"。' +
            '不能包含 .. ',
        },
      },
    },
  },
  {
    name: 'read_source_file',
    description:
      '【只读】读取用户原项目里某个源码文件 — 用来获取设计上下文。' +
      '输出带 **cat -n 行号**(`  42→<content>`)+ 截断 footer,跟 read_file 一致。' +
      '\n\n**典型用法**:' +
      '\n  - read_source_file("package.json") → 看技术栈、版本、name/description' +
      '\n  - read_source_file("README.md") → 看产品定位' +
      '\n  - read_source_file("src/styles/tokens.css") → 看现有设计 token' +
      '\n  - read_source_file("src/components/Button.tsx") → 看现有组件风格' +
      '\n\n**约束**:' +
      '\n  - 二进制(图片等)只返回 metadata' +
      '\n  - 单文件 > 256KB 自动截断(返回前 256KB + footer 提示)' +
      '\n  - 拒绝读 .design/(那是你自己写的,该用 read_file)' +
      '\n  - 拒绝读 node_modules / dist 等(没设计价值)' +
      '\n\n**写永远不可能写到这里** — 你的所有 write_file / edit_file 都进 .design/。',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对项目根的路径,如 "package.json" 或 "src/index.tsx"',
        },
        offset: { type: 'number', description: '0-indexed 起始行,默认 0' },
        limit: { type: 'number', description: '读取行数上限,默认 2000' },
      },
      required: ['path'],
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
    name: 'apply_patch',
    description:
      '【批量补丁】一次性改一个或多个文件 — 多 hunk、多文件、**原子化**(任一 hunk 找不到 → 全部回滚不写)。' +
      '\n\n比 N 次 edit_file 强的地方:' +
      '\n  - **N 个独立改动一个 turn 搞定**(refactor 改名 / 同时改 HTML 和 CSS / 一改改 5 个变体)' +
      '\n  - **原子性**:中途一个失败不会留下半成品状态' +
      '\n  - **创建 / 删除 / 修改 三合一**:patches[].operation = update | create | delete' +
      '\n\n何时用 apply_patch vs edit_file:' +
      '\n  - 单文件单 hunk → edit_file 更简洁' +
      '\n  - 多 hunk 同一文件 / 多文件协同改 → apply_patch' +
      '\n  - 大改一整文件 → 还是 write_file' +
      '\n\nhunk 规则(同 edit_file 的 old/new):' +
      '\n  - old 必须**逐字符**出现在文件里(含缩进/空格/换行)' +
      '\n  - old 在文件中**必须唯一**;不唯一时扩展 old 包更多上下文,**不要**用 replace_all 在 patch 里' +
      '\n  - 同一文件多 hunk 时,按数组顺序应用,后面 hunk 看的是前面 hunk 应用后的内容' +
      '\n\n返回:per-file 报告 + 总 diff stat(+N -M)。失败时列出**所有**问题 hunk(不会"第一个失败就停"),' +
      'AI 一次能看到全图改一遍即可。',
    input_schema: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对 .design/ 的路径' },
              operation: {
                type: 'string',
                enum: ['update', 'create', 'delete'],
                description: '默认 update;create 时需要 content;delete 不需要 hunks/content',
              },
              hunks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    old: {
                      type: 'string',
                      description: '要被替换的精确文本(含上下文行)',
                    },
                    new: {
                      type: 'string',
                      description: '替换后的文本',
                    },
                  },
                  required: ['old', 'new'],
                },
              },
              content: {
                type: 'string',
                description: 'operation=create 时的文件全文',
              },
            },
            required: ['path'],
          },
          description: '要应用的所有 patch;按数组顺序,原子化提交',
        },
      },
      required: ['patches'],
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
      '读取 .design/ 内的一个文件。输出**带 cat -n 风格行号**(`  42→<content>`);' +
      '截断时显式带 `[file has N lines · showing M-K · pass offset=K to continue]` footer。' +
      '二进制文件只返 metadata(`<binary file: 234KB png>`)。' +
      '\n\n**用 line numbers 引用位置** —— 后续 edit_file / apply_patch / 给用户讲解都基于这些行号。' +
      '\n\n默认 limit=2000 行;别为省 token 故意调小,context manager 会自动 elide 老 result。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对 .design/ 的路径,如 "index.html"' },
        offset: { type: 'number', description: '0-indexed 起始行,默认 0' },
        limit: { type: 'number', description: '读取行数上限,默认 2000' },
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
    name: 'generate_image',
    description:
      '【慎用】用 AI 图像模型(gpt-image-1 / DALL-E 3 / 阿里万相等)生成素材图,存到项目 uploads/ 目录。' +
      '\n\n**何时调用 — 必须满足以下任一条件**:' +
      '\n  1. 用户明确说"帮我生成一张/几张图"或类似指令' +
      '\n  2. 用户答复你的"要不要帮你生一张图?"问题,选了"要"' +
      '\n  3. 你的回答里已经明确说明"我会生成一张 X 的图" 且 prompt 描述清晰' +
      '\n\n**绝对不要做的**:' +
      '\n  - 看到 hero 区/插画位就自己悄悄生图(违反 design-work 纪律,placeholder 优先)' +
      '\n  - 一次性给同个位置生 3 张让用户挑(浪费用户钱)' +
      '\n  - 在 logo / banner / 按钮上"生成带文字的图"(AI 图模型画文字几乎必错,文字用 HTML 叠加)' +
      '\n\nbatch 模式:filenames 多个 + prompts 同样多个 → 一次工具调用批量生成多张,适合需要"风格一致的多张 icon" / "同一系列插画"等场景。注意每张都按 standard $0.04 / high $0.17 单独计费。' +
      '\n\n参数说明:' +
      '\n  - prompt:画什么的描述(英文质量更稳)。主体 + 风格 + 色调 + 构图' +
      '\n  - filename:存 uploads/ 下的文件名,如 "hero-bg.png"。自动加 uploads/ 前缀' +
      '\n  - size:1024x1024 / 1024x1792(竖) / 1792x1024(横),默认 1024x1024' +
      '\n  - quality:standard(便宜)/ high(关键素材用,4x 价格)' +
      '\n  - batch:数组形式,每项 { filename, prompt }。给了 batch 就忽略顶层 prompt/filename' +
      '\n\n费用 + 延迟:standard $0.04/张,high $0.17/张;生成 5-30s,iframe 自动加载结果。',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '单图模式 — 图像描述' },
        filename: { type: 'string', description: '单图模式 — 文件名(含 .png 后缀)' },
        size: {
          type: 'string',
          enum: ['1024x1024', '1024x1792', '1792x1024'],
          description: '默认 1024x1024,batch 模式下整 batch 共用此 size',
        },
        quality: {
          type: 'string',
          enum: ['standard', 'high'],
          description: '默认 standard,batch 模式下整 batch 共用此 quality',
        },
        batch: {
          type: 'array',
          description: '批量模式 — 每张图独立 filename + prompt,顺序生成',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              prompt: { type: 'string' },
            },
            required: ['filename', 'prompt'],
          },
        },
      },
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
  ...SOURCE_TOOLS, // Electron + native 项目时才有实际意义,但工具名注册不依赖运行时
  ...SEARCH_TOOLS,
  ...PLAN_TOOLS,
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
    case 'apply_patch':
      return execApplyPatch(input, ctx);
    case 'read_file':
      return execReadFile(input, ctx);
    case 'list_files':
      return execListFiles(ctx);
    case 'delete_file':
      return execDeleteFile(input, ctx);
    case 'show_to_user':
      return execShowToUser(input, ctx);
    case 'generate_image':
      return execGenerateImage(input, ctx);
    case 'done':
      return execDone(input, ctx);
    case 'get_element_info':
      return execGetElementInfo(input, ctx);
    case 'replace_element_text':
      return execReplaceElementText(input, ctx);
    case 'ask_questions':
      return execAskQuestions(input, ctx);
    case 'list_source_files':
      return execListSourceFiles(input, ctx);
    case 'read_source_file':
      return execReadSourceFile(input, ctx);
    case 'search_files':
      return execSearchFiles(input, ctx);
    case 'todo_write':
      return execTodoWrite(input, ctx);
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

// ============================================================
// apply_patch — multi-file atomic
// ============================================================

interface PatchHunk {
  old: string;
  new: string;
}
interface PatchEntry {
  path: string;
  operation: 'update' | 'create' | 'delete';
  hunks?: PatchHunk[];
  content?: string;
}

interface PatchSimResult {
  path: string;
  operation: 'update' | 'create' | 'delete';
  nextContent: string | null; // null = delete
  hunks: number;
  charsBefore: number;
  charsAfter: number;
  errors: string[]; // 空 = 这个 patch ok
}

async function execApplyPatch(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const raw = Array.isArray(input?.patches) ? input.patches : [];
  if (raw.length === 0) {
    return { content: 'patches 数组不能为空', is_error: true };
  }

  // 规范化
  const patches: PatchEntry[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const path = String(p.path ?? '').trim();
    if (!isValidPath(path)) {
      return { content: `路径不合法: ${path}`, is_error: true };
    }
    const operation = (p.operation as 'update' | 'create' | 'delete') ?? 'update';
    const hunks = Array.isArray(p.hunks)
      ? p.hunks
          .filter(
            (h: any) =>
              h && typeof h.old === 'string' && typeof h.new === 'string'
          )
          .map((h: any) => ({ old: String(h.old), new: String(h.new) }))
      : [];
    const content = typeof p.content === 'string' ? p.content : undefined;
    patches.push({ path, operation, hunks, content });
  }

  // === 1. Simulate all patches in memory ===
  const sims: PatchSimResult[] = [];
  for (const p of patches) {
    const existing = await readFile(ctx.projectId, p.path);
    const sim: PatchSimResult = {
      path: p.path,
      operation: p.operation,
      nextContent: null,
      hunks: p.hunks?.length ?? 0,
      charsBefore: existing?.content.length ?? 0,
      charsAfter: 0,
      errors: [],
    };

    if (p.operation === 'create') {
      if (existing) {
        sim.errors.push(
          `create 失败:${p.path} 已存在(${existing.content.length} 字符)。改用 update + hunks 修改它,或先 delete。`
        );
      } else if (typeof p.content !== 'string') {
        sim.errors.push('create 需要 content 字段');
      } else {
        sim.nextContent = p.content;
        sim.charsAfter = p.content.length;
      }
    } else if (p.operation === 'delete') {
      if (!existing) {
        sim.errors.push(`delete 失败:${p.path} 不存在`);
      } else {
        sim.nextContent = null; // 标记删除
      }
    } else {
      // update
      if (!existing) {
        sim.errors.push(
          `update 失败:${p.path} 不存在。新文件用 operation="create" + content。`
        );
      } else if (existing.type === 'binary') {
        sim.errors.push(`update 失败:${p.path} 是二进制,不能 patch`);
      } else if (p.hunks!.length === 0) {
        sim.errors.push('update 需要至少一个 hunk');
      } else {
        let cur = existing.content;
        const errs: string[] = [];
        for (let i = 0; i < p.hunks!.length; i++) {
          const h = p.hunks![i];
          if (h.old === h.new) {
            errs.push(`hunk ${i + 1}: old === new(no-op)`);
            continue;
          }
          const occ = countOccurrences(cur, h.old);
          if (occ === 0) {
            errs.push(
              `hunk ${i + 1}: old 未找到 — 缩进/换行/EOL 不匹配? 先 read_file 看现状。` +
                `\n    搜过的 head: ${JSON.stringify(h.old.slice(0, 80))}…`
            );
            continue;
          }
          if (occ > 1) {
            errs.push(
              `hunk ${i + 1}: old 在文件里出现 ${occ} 次,匹配不唯一 — 扩展 old 包更多 context 行让它唯一`
            );
            continue;
          }
          const idx = cur.indexOf(h.old);
          cur = cur.slice(0, idx) + h.new + cur.slice(idx + h.old.length);
        }
        if (errs.length === 0) {
          sim.nextContent = cur;
          sim.charsAfter = cur.length;
        } else {
          sim.errors = errs;
        }
      }
    }
    sims.push(sim);
  }

  // === 2. 任一失败 → 全部回滚(报告所有错误,不停在第一个)===
  const anyFailed = sims.some((s) => s.errors.length > 0);
  if (anyFailed) {
    const lines: string[] = ['[apply_patch FAILED — no files were written]'];
    for (const s of sims) {
      if (s.errors.length === 0) {
        lines.push(`  ✓ ${s.path} (${s.operation}) — would have applied cleanly`);
      } else {
        lines.push(`  ✗ ${s.path} (${s.operation}):`);
        for (const e of s.errors) lines.push(`     - ${e}`);
      }
    }
    lines.push('');
    lines.push('Fix the failing hunks and call apply_patch again. Successful patches above were not applied.');
    return { content: lines.join('\n'), is_error: true };
  }

  // === 3. 全 OK → 实际写盘(D11 等 lint 也跑一遍)===
  for (const s of sims) {
    ctx.onWriteStart?.(s.path);
    if (s.operation === 'delete') {
      await deleteFiles(ctx.projectId, [s.path], 'ai');
    } else {
      // create / update 都走 writeFile(覆盖)。先跑 lint(同 write_file)
      const next = s.nextContent ?? '';
      // commentary lint(D10):variants/<slug>/index.html 必须有头部块
      const lintCommentary = lintVariantCommentary(s.path, next);
      if (!lintCommentary.ok) {
        return {
          content:
            `[apply_patch 部分应用后被 detector 拦截 — ${s.path}]\n${lintCommentary.reason}\n` +
            `已应用的 patches 保留(数据不丢);修完 commentary 再补一次 apply_patch 即可。`,
          is_error: true,
        };
      }
      const processed = postProcessOnWrite(s.path, next);
      await writeFile(ctx.projectId, s.path, processed, 'text', 'ai');
    }
  }

  // === 4. 渲染成功报告 ===
  const lines: string[] = [
    `[apply_patch OK — ${sims.length} file${sims.length > 1 ? 's' : ''} touched]`,
  ];
  let totalAdd = 0;
  let totalRem = 0;
  for (const s of sims) {
    const delta = s.charsAfter - s.charsBefore;
    if (delta >= 0) totalAdd += delta;
    else totalRem += -delta;
    const tag =
      s.operation === 'create' ? '[+new]' : s.operation === 'delete' ? '[-del]' : `[${s.hunks} hunk${s.hunks > 1 ? 's' : ''}]`;
    lines.push(
      `  ${tag} ${s.path}  (${s.charsBefore} → ${s.charsAfter} chars, ${delta >= 0 ? '+' : ''}${delta})`
    );
  }
  lines.push(`  total: +${totalAdd} −${totalRem} chars`);
  return { content: lines.join('\n') };
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

// === read hash cache(file-hash unchanged 优化)===
// key = `${projectId}:design:${path}` or `${projectId}:source:${path}`
// value = 最近一次给 LLM 的内容 hash(简化:用 length + 前后 32 字符当签名,不上 SHA)
const recentReadCache = new Map<string, { sig: string; turnHint: string }>();
function quickSig(content: string): string {
  return `${content.length}:${content.slice(0, 32)}:${content.slice(-32)}`;
}
function readCacheGet(key: string): { sig: string; turnHint: string } | undefined {
  return recentReadCache.get(key);
}
function readCacheSet(key: string, sig: string, turnHint: string) {
  recentReadCache.set(key, { sig, turnHint });
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

  // file-hash 短路:同 path + 同 sig + 默认页(无 offset/limit) → 返 stub,完全不送内容给 LLM
  if (offset == null && limit == null) {
    const key = `${ctx.projectId}:design:${path}`;
    const cached = readCacheGet(key);
    const sig = quickSig(f.content);
    if (cached && cached.sig === sig) {
      return {
        content:
          `[file unchanged since ${cached.turnHint} — content elided. ` +
          `Reuse the prior read_file(.design/${path}) result; or pass offset/limit to force re-read a specific range.]`,
      };
    }
    readCacheSet(key, sig, `this turn`);
  }

  // v6.1:cat -n 行号 + 截断透明度 + path footer
  const clamped = clampForRead(f.content);
  const formatted = formatFileForLLM({
    content: clamped.content,
    offset,
    limit,
    path: `.design/${path}`,
  });
  const prefix = clamped.clamped
    ? `[file very large — clamped to first 256KB of ${(clamped.origBytes / 1024).toFixed(0)}KB]\n`
    : '';
  return { content: prefix + formatted };
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

async function getProjectRootForSource(
  ctx: ToolExecCtx
): Promise<{ rootPath: string } | { error: string }> {
  if (!isElectron()) {
    return {
      error:
        '只在 Electron 桌面版可用(浏览器版没有真文件访问权限)。' +
        '如果用户在浏览器,告诉他需要切到桌面版。',
    };
  }
  const proj = await db.projects.get(ctx.projectId);
  if (!proj?.rootPath) {
    return {
      error:
        '此项目还没绑定本地文件夹(legacy 虚拟项目)。' +
        '左栏点 🔗 给项目绑一个文件夹后再调用此工具。',
    };
  }
  return { rootPath: proj.rootPath };
}

async function execListSourceFiles(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const subPath = String(input?.path ?? '').trim();
  if (subPath.includes('..'))
    return { content: 'path 不能包含 ..', is_error: true };
  const r = await getProjectRootForSource(ctx);
  if ('error' in r) return { content: r.error, is_error: true };
  try {
    const { entries, gitMode, truncated } = await native()!.fs.listSource(
      r.rootPath,
      subPath
    );
    if (entries.length === 0) {
      return {
        content:
          `(${subPath || '根目录'} 在 ${gitMode ? 'git' : '黑名单'} 维度看是空的)`,
      };
    }
    const lines = entries.map((e) => {
      if (e.kind === 'dir') return `${e.path}/`;
      const sizeStr =
        e.size > 1024
          ? `(${Math.round(e.size / 1024)}KB)`
          : `(${e.size}B)`;
      return `${e.path} ${e.type === 'binary' ? '[binary]' : ''} ${sizeStr}`.trim();
    });
    const head = `[${gitMode ? 'git mode' : 'blacklist mode'}] listing ${subPath || '<root>'} (${entries.length} entries)`;
    const tail = truncated
      ? '\n\n[这一层超 200 项被截断 — 不太可能值得继续探索;换个目录]'
      : '';
    return { content: head + '\n' + lines.join('\n') + tail };
  } catch (e: any) {
    return { content: `list failed: ${e?.message ?? e}`, is_error: true };
  }
}

async function execReadSourceFile(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const path = String(input?.path ?? '').trim();
  if (!path) return { content: 'path 不能为空', is_error: true };
  const offset = typeof input?.offset === 'number' ? input.offset : undefined;
  const limit = typeof input?.limit === 'number' ? input.limit : undefined;
  const r = await getProjectRootForSource(ctx);
  if ('error' in r) return { content: r.error, is_error: true };
  try {
    const f = await native()!.fs.readSource(r.rootPath, path);
    if (!f) return { content: `not found: ${path}`, is_error: true };
    if (f.type === 'binary') {
      return { content: f.content }; // 已经是 metadata 占位字符串
    }
    // file-hash 短路(同 read_file)
    if (offset == null && limit == null) {
      const key = `${ctx.projectId}:source:${path}`;
      const cached = readCacheGet(key);
      const sig = quickSig(f.content);
      if (cached && cached.sig === sig) {
        return {
          content:
            `[file unchanged since ${cached.turnHint} — content elided. ` +
            `Reuse the prior read_source_file(${path}) result; or pass offset/limit to force re-read.]`,
        };
      }
      readCacheSet(key, sig, `this turn`);
    }
    const formatted = formatFileForLLM({
      content: f.content,
      offset,
      limit,
      path,
    });
    return { content: formatted };
  } catch (e: any) {
    return { content: `read failed: ${e?.message ?? e}`, is_error: true };
  }
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

async function execGenerateImage(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const size = input?.size ?? '1024x1024';
  const quality = input?.quality ?? 'standard';

  // 拼出任务列表:batch 模式 → 每项独立;单图模式 → 一个任务
  type Job = { prompt: string; filename: string };
  let jobs: Job[];
  if (Array.isArray(input?.batch) && input.batch.length > 0) {
    jobs = input.batch.map((b: any) => ({
      prompt: String(b?.prompt ?? '').trim(),
      filename: String(b?.filename ?? '').trim(),
    }));
  } else {
    jobs = [{
      prompt: String(input?.prompt ?? '').trim(),
      filename: String(input?.filename ?? '').trim(),
    }];
  }
  // 校验每项
  for (const j of jobs) {
    if (!j.prompt || !j.filename) {
      return { content: '每个任务都必须有 prompt + filename(batch 模式下 batch 数组里每项亦然)', is_error: true };
    }
    if (!j.filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
      return { content: `filename 必须以 .png/.jpg/.webp 结尾,收到 "${j.filename}"`, is_error: true };
    }
  }
  // 强制 uploads/ 前缀
  jobs = jobs.map((j) => ({
    prompt: j.prompt,
    filename: j.filename.replace(/^\/+/, '').replace(/^uploads\/+/, ''),
  }));

  const { generateImage } = await import('./imageGenClient');

  const results: Array<{ path: string; cost?: number; revised?: string; model?: string }> = [];
  const errors: Array<{ filename: string; error: string }> = [];

  for (let i = 0; i < jobs.length; i++) {
    if (ctx.signal.aborted) {
      errors.push({ filename: jobs[i].filename, error: 'aborted by user' });
      break;
    }
    const j = jobs[i];
    const targetPath = `uploads/${j.filename}`;
    ctx.onWriteStart?.(
      jobs.length > 1
        ? `${targetPath} (AI 生图中 ${i + 1}/${jobs.length}…)`
        : `${targetPath} (AI 生图中…)`,
    );
    try {
      const r = await generateImage(
        { prompt: j.prompt, size, quality },
        ctx.signal,
      );
      if (r.images.length === 0) {
        errors.push({ filename: j.filename, error: 'provider 返回空图' });
        continue;
      }
      await writeFile(ctx.projectId, targetPath, r.images[0], 'binary', 'ai');
      results.push({
        path: targetPath,
        cost: r.estimatedCost,
        revised: r.revisedPrompt && r.revisedPrompt !== j.prompt ? r.revisedPrompt : undefined,
        model: r.model,
      });
    } catch (e: any) {
      errors.push({ filename: j.filename, error: e?.message ?? String(e) });
    }
  }

  // 全失败 → is_error
  if (results.length === 0) {
    const errText = errors.map((e) => `  - ${e.filename}: ${e.error}`).join('\n');
    return {
      content: `全部生图失败:\n${errText}\n\n常见原因:image provider 没配 key(设置面板 → Image tab),或上游限流。换 provider 重试。`,
      is_error: true,
    };
  }

  // 汇总报告
  const lines: string[] = [];
  if (jobs.length > 1) {
    lines.push(`✓ batch 生图完成:${results.length}/${jobs.length} 成功`);
  } else {
    lines.push(`✓ 图已生成并保存到 ${results[0].path}`);
  }
  let totalCost = 0;
  for (const r of results) {
    lines.push(`  - ${r.path}${r.cost ? ` (~$${r.cost.toFixed(3)})` : ''}`);
    if (r.revised) lines.push(`    revised: ${r.revised.slice(0, 200)}`);
    totalCost += r.cost ?? 0;
  }
  if (totalCost > 0 && results.length > 1) {
    lines.push(`total estimated cost: $${totalCost.toFixed(3)}`);
  } else if (results.length === 1 && results[0].cost) {
    lines.push(`estimated cost: $${results[0].cost.toFixed(3)}`);
  }
  if (errors.length > 0) {
    lines.push(`\n⚠ ${errors.length} 个失败:`);
    for (const e of errors) lines.push(`  - ${e.filename}: ${e.error}`);
  }
  lines.push(`\n下一步:在 HTML 里写 <img src="uploads/..." alt="...">`);
  return { content: lines.join('\n') };
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

// ============================================================
// search_files
// ============================================================

async function execSearchFiles(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const pattern = String(input?.pattern ?? '').trim();
  if (!pattern) return { content: 'pattern 不能为空', is_error: true };

  const r = await getProjectRootForSource(ctx);
  if ('error' in r) return { content: r.error, is_error: true };

  const opts = {
    pattern,
    glob: input?.glob ? String(input.glob) : undefined,
    scope: (input?.scope as 'design' | 'source' | 'both') ?? 'both',
    caseSensitive: !!input?.caseSensitive,
    maxResults:
      typeof input?.maxResults === 'number' ? input.maxResults : undefined,
    contextLines:
      typeof input?.contextLines === 'number' ? input.contextLines : undefined,
  };

  try {
    const result = await native()!.fs.search(r.rootPath, opts);
    if (result.hits.length === 0) {
      return {
        content:
          `[no matches for ${opts.scope === 'design' ? '.design' : opts.scope}` +
          ` · pattern=/${pattern}/${opts.caseSensitive ? '' : 'i'}` +
          (opts.glob ? ` · glob=${opts.glob}` : '') +
          ` · ${result.filesScanned} files scanned]`,
      };
    }

    // 渲染:`path:line  match`,每个命中前后带 context
    const lines: string[] = [];
    const head =
      `[${result.hits.length}${result.truncated ? '+' : ''} matches` +
      ` · ${result.filesScanned} files scanned` +
      ` · scope=${opts.scope}` +
      ` · mode=${result.patternMode}` +
      (opts.glob ? ` · glob=${opts.glob}` : '') +
      `]`;
    lines.push(head);
    lines.push('');

    let lastPath = '';
    for (const h of result.hits) {
      if (h.path !== lastPath) {
        if (lastPath) lines.push(''); // 文件间空行
        lines.push(`▼ ${h.path}`);
        lastPath = h.path;
      }
      const beforeStart = h.line - h.contextBefore.length;
      h.contextBefore.forEach((ln, i) => {
        lines.push(`${String(beforeStart + i).padStart(5, ' ')}  ${ln}`);
      });
      lines.push(`${String(h.line).padStart(5, ' ')}→ ${h.match}`);
      h.contextAfter.forEach((ln, i) => {
        lines.push(`${String(h.line + 1 + i).padStart(5, ' ')}  ${ln}`);
      });
    }

    if (result.truncated) {
      lines.push('');
      lines.push(
        `[truncated at ${result.hits.length} hits · narrow pattern or use glob to reduce]`
      );
    }

    return { content: lines.join('\n') };
  } catch (e: any) {
    return { content: `search failed: ${e?.message ?? e}`, is_error: true };
  }
}

// ============================================================
// todo_write
// ============================================================

async function execTodoWrite(
  input: any,
  ctx: ToolExecCtx
): Promise<ToolResult> {
  const raw = Array.isArray(input?.todos) ? input.todos : [];
  const todos: Array<{
    id: string;
    content: string;
    activeForm: string;
    status: 'pending' | 'in_progress' | 'completed';
  }> = [];

  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const content = String(t.content ?? '').trim();
    const activeForm = String(t.activeForm ?? '').trim();
    const status = String(t.status ?? 'pending') as 'pending' | 'in_progress' | 'completed';
    if (!content || !activeForm) continue;
    if (!['pending', 'in_progress', 'completed'].includes(status)) continue;
    const id = String(t.id ?? '').trim() || `t_${Math.random().toString(36).slice(2, 8)}`;
    todos.push({ id, content, activeForm, status });
  }

  // 纪律 lint:同时只能有一个 in_progress
  const inProg = todos.filter((t) => t.status === 'in_progress');
  if (inProg.length > 1) {
    return {
      content:
        `todo_write 被拒:同时不能有 ${inProg.length} 个 in_progress(只能 1 个)。` +
        `把其中一个改成 pending 或 completed 再调一次。`,
      is_error: true,
    };
  }

  ctx.onTodoUpdate?.(todos);

  if (todos.length === 0) {
    return { content: '[todos cleared]' };
  }

  const counts = {
    pending: todos.filter((t) => t.status === 'pending').length,
    in_progress: inProg.length,
    completed: todos.filter((t) => t.status === 'completed').length,
  };
  const lines = [
    `[todos updated · ${todos.length} total · ${counts.completed} ✓ / ${counts.in_progress} ▸ / ${counts.pending} ○]`,
  ];
  for (const t of todos) {
    const mark =
      t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○';
    const display = t.status === 'in_progress' ? t.activeForm : t.content;
    lines.push(`  ${mark} ${display}`);
  }
  return { content: lines.join('\n') };
}
