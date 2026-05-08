# ai-design

AI + 设计师协作客户端 — 左聊天、右交互面板,AI 直接写 HTML 即所见。**v1.5 起前后端分离**:Hono 后端持有 system prompt + API key,React 前端纯 UI + 工具执行。

```
chat 写文件 → iframe 立刻刷
指代靠手势  → 用户点元素而不是描述
调参靠拉    → AI 给 Tweak 控件,用户拉数值即生效
```

## 跑起来

```bash
pnpm install

# 1. 复制 .env.example 成 .env,填 PROVIDER / MODEL / API_KEY / BASE_URL
cp .env.example .env
# 编辑 .env

pnpm dev
# server:  http://localhost:5174
# client:  http://localhost:5173
```

`pnpm dev` 用 concurrently 同时起 Hono 后端 (`tsx watch server/index.ts`) + Vite 前端。

模型管理在 .env,**前端没有 key 输入框**。改完重启 dev 即生效。

试问:**"做一个产品落地页"**,看 chat 流式吐 `Recon:` + `Unknowns:`,中栏 Questions tab 自动亮起。

## 架构 30 秒版

```
浏览器 (5173)                              Node 后端 (5174)
┌──────────────────────────────┐           ┌──────────────────────┐
│ React UI(三栏)              │           │ Hono                 │
│ ├─ FileTree                  │           │ ├─ /api/llm/chat SSE │
│ ├─ MidPane (Preview/Q tab)  │ ──fetch──▶│ │   注入 system+调上游│
│ └─ ChatPane                  │           │ │   流式回 Delta     │
│                              │           │ └─ /api/llm/config   │
│ store: IndexedDB (Dexie)     │           │                      │
│   files / messages / ...     │           │ skill.md (28KB)       │
│ chat.ts: tool loop + abort  │           │ systemPrompt.ts       │
│ tool execute (write_file 等) │           │ provider: Anthropic   │
│                              │           │           / OpenAI    │
│ SW: /preview/<id>/* serve    │           │ .env: API_KEY etc.   │
└──────────────────────────────┘           └──────────────────────┘
```

**前后端职责切分**

| 后端拥有 | 前端拥有 |
|---|---|
| API key(.env) | UI 渲染、状态 |
| system prompt(SKILL.md + coda) | IndexedDB 文件系统 |
| 上游 SDK 调用(Anthropic / OpenAI) | 工具循环(chat.ts) |
| SSE 流式归一化 | 工具执行(write_file 等动 IDB) |

**核心约束**:前端永远拿不到 key 和 system prompt(直接 view-source 也看不到),改 prompt 只重启 server 不影响前端缓存。

**前端关键模块**:
- 持久化:IndexedDB(Dexie)— projects · files · messages · snapshots · settings
- 预览:Service Worker 拦截 `/preview/<projectId>/*`,从 IndexedDB serve 文件给 iframe
- 多 tab 隔离:SW 给 iframe 注入 `window.__previewProjectId`,消息按 projectId 过滤
- 工具循环:9 个工具 `write_file / read_file / list_files / delete_file / show_to_user / done / get_element_info / replace_element_text / ask_questions`
- 元素 ID:HTML 文件入库前**自动**注入 `data-aid` 到语义元素(确定性后处理,不靠 prompt)
- 撤回:每 assistant turn 打 diff 快照;消息旁挂 ↶ 回滚按钮(整 turn 范围)
- 模式切换:preview / inspect / comment / edit
- Tweak 双向持久化:`<!-- TWEAK -->` / `/* TWEAK */` / `// TWEAK` 按文件类型路由

**后端关键模块**:
- `server/index.ts` — Hono 入口 + SSE
- `server/llm/{anthropic,openai,factory,types}.ts` — provider 抽象
- `server/llm/systemPrompt.ts` — SKILL.md + runtime mapping coda
- `server/skill.md` — 设计纪律本体(28KB)

## 安全模型(v1.5)

**API key 永远只在后端 .env**,前端代码、IndexedDB、localStorage 都不存。即便 iframe 中的 inject.js 通过 `window.parent.document` 渗透,也拿不到 key —— 它在另一个进程里。

**system prompt 永远只在后端**(SKILL.md + coda),前端 view-source / network 抓包都看不到完整 prompt(只看到前端发出去的 messages + tools schema,不含 system)。

dev 阶段后端 CORS 设的是 `*`,生产应限同源。后端 .env 不要 commit(默认 .gitignore 已加)。

## v1 不做(明确)

- ❌ 元素级点选 / 评论 / 直改文字 → v2
- ❌ Tweak 控件 → v3
- ❌ Figma-style 多变体并排画布 → v4
- ❌ JSX/TSX(浏览器跑不了)→ v4 上 Babel 时再开
- ❌ Monaco 直接源码编辑 → 改文件靠 chat
- ❌ 后台子代理验证 / starter 库 / 跨项目引用 → v5
- ❌ Tauri 包装 / OS keyring / PPTX/PDF 导出 → v6

## v1 验收 checklist

跑过这些算 v1 done(手测):

**核心闭环**
- [ ] 输入"做个 SaaS 落地页",AI 写完整轮(可能多个文件),turn 结束才刷一次预览,期间无闪烁
- [ ] 用户说"主按钮换橙色",AI 改对的文件,turn 结束预览刷新
- [ ] 作品里有 console error,AI 调 done 后 chat 末尾出现"⚠ 要让 AI 修吗?[是][否]" 卡片
- [ ] 关浏览器再回来,文件 + chat 历史 + snapshots 完整保留
- [ ] 切 provider(Anthropic ↔ OpenAI)历史消息能正常重发

**中断 + 撤回**
- [ ] AI 跑到一半"停止" → 立即停;已写的文件保留;chat 末尾出现 [用户中断]
- [ ] 每条 assistant 消息旁有 ↶ 回滚;第一次回滚弹 warning;确认后该 turn 文件改动回退

**安全 + 多 tab**
- [ ] 关 tab 重开,要重新输 key
- [ ] 同时开两个项目 tab,A tab 的 console.log 不会跑到 B tab 上

**附件**
- [ ] 拖图到 chat 输入框 → AI 能"看到"图;复述图里的元素
- [ ] 拖图到文件树 → 进 uploads/;AI read_file 拿 metadata,但能写 `<img src="uploads/x.png">`

**导出**
- [ ] "导出 zip"打包,解压能 `python3 -m http.server` 直接打开
- [ ] 勾"干净版"导出 → HTML 里没有 data-aid

## 文件结构

```
ai-design/
├─ .env / .env.example         ← 后端配置(API_KEY 等,gitignore)
├─ vite.config.ts              ← 前端 + /api proxy 到 5174
├─ package.json                ← pnpm dev = 同时起 server + client
│
├─ server/                      ← Hono 后端(:5174)
│  ├─ index.ts                 ← 入口 + SSE 路由
│  ├─ skill.md                 ← design-work SKILL.md 副本(28KB)
│  ├─ llm/
│  │  ├─ types.ts              ← 协议类型
│  │  ├─ provider.ts ?         ← (在 types.ts 里)
│  │  ├─ anthropic.ts          ← Anthropic SDK
│  │  ├─ openai.ts             ← OpenAI 规范 SDK(支持 baseUrl)
│  │  ├─ factory.ts
│  │  └─ systemPrompt.ts       ← SKILL.md + runtime mapping coda
│  └─ tsconfig.json            ← Node 环境(独立)
│
├─ src/                         ← React 前端(:5173)
│  ├─ main.tsx · App.tsx
│  ├─ layout/      Shell · FileTree · MidPane · PreviewPane · ChatPane · QuestionsPanel · ModeToggle · TweaksPanel
│  ├─ store/       db(Dexie) · projects · files · chat(loop+abort) · snapshots · userActionBuffer
│  ├─ llm/         provider(interface) · clientProvider(SSE) · tools · questions · contextManager
│  ├─ preview/     swRegister · sandboxBridge · injectBuilder · postProcess · elementBridge
│  ├─ inspect/     inlineEdit · commentBubble
│  ├─ tweaks/      markerParser · markerWriter · controls
│  ├─ attachments/ vision · uploads
│  ├─ settings/    ModelSettings(只读) · exportProject
│  └─ components/  Markdown · ToolCallBlock · AttachmentChip
│
└─ public/
   ├─ sw.js                    ← 拦截 /preview/<id>/* serve IDB 文件
   └─ __aid_inject.js          ← iframe 注入:console + error 转发 + inspect/edit
```

## 下一步

- Sprint 2:元素级交互(`data-aid` 已经在,加 inspect/edit/comment 模式)
- Sprint 3:Tweak marker 双向持久化
- Sprint 4 起见 plan 后续路线
