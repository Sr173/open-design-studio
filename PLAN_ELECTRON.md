# ai-design v6 — Electron 套壳 plan

## 一句话愿景

> 桌面 App 启动 → 选一个本地文件夹(空目录 / git 仓库 / 已有项目子目录) →
> AI 直接读写真文件 + 用户在 VSCode 改的文件自动同步进 chat →
> 同时保留现有的左聊天/右预览/Tweaks 全部体验。

## 已敲定的决策(在前一轮对话里讨论)

| # | 决策 |
|---|---|
| 框架 | **Electron** — 全平台 Chromium 一致(设计工具命门)+ Hono 0 改动 |
| 后端 | Hono **在 main process 同进程跑**,起在 127.0.0.1 随机端口 + 鉴权 token |
| 项目模型 | 项目可以是 **空文件夹** 或 **已存在文件夹**(C3:支持 root + 可选 subdir) |
| 预览 | localhost HTTP server(替换 SW)+ 文件 watcher 自动刷新 |
| Snapshot | v6.0 沿用 IDB diff(D1);v6.1 看用户反馈再上 git stash 选项 |
| 文件监听 | **chokidar** watch 项目根 → 外部改动自动刷新 + push 到 userActionBuffer 让 AI 知道 |
| Git 集成 | F1(只读状态展示)+ F2(AI 可见 `git_status` 工具),不做 commit/push |
| API Key | **keytar** 存 OS keyring(macOS keychain / Win DPAPI / Linux libsecret) |

## 与浏览器版的核心架构差异

| 模块 | 浏览器版 | Electron 版 |
|---|---|---|
| 文件 CRUD | `src/store/files.ts` → Dexie | 同一接口,但底层 dispatcher:Tauri 检测下走 IPC 调 main 的 fs |
| 项目元数据 | IDB `projects` 表 | IDB **保留**(chats/messages/snapshots 都在那),`projects.rootPath: string \| null` 新字段 |
| 预览 | SW 拦截 `/preview/<id>/<path>` | Hono renderer 启 `127.0.0.1:<port>` 服务项目根;iframe src 切过去 |
| API Key | Web Crypto + sessionStorage nonce | IPC → main → keytar(永远不进 renderer 内存超过单次请求生命周期) |
| Chat ↔ LLM | renderer 直接 fetch `/api/llm/chat`(Hono 端口同源) | 同上,只是 base URL 变成 `http://127.0.0.1:<dynamic>/api/...` + Authorization 头带 token |
| `__aid_inject.js` 注入 | SW 拦截 HTML 时注入 | Hono 静态文件中间件拦截 HTML 时注入(逻辑直接复用) |
| 文件监听 | 无(浏览器拿不到) | chokidar 在 main,事件 IPC 推给 renderer |

> 关键不变量:**renderer 层代码尽量 0 改动**。所有 native 调用走 `contextBridge.exposeInMainWorld('aiDesignNative', {...})`,
> renderer 调 `window.aiDesignNative.fs.read(path)` 之类。Tauri / Electron 不同 backend 都能挂同一个 contract。

## 目录结构(Electron 加进来后)

```
ai-design/
├─ electron/                    ← 新增,所有 Electron 主进程代码
│  ├─ main.ts                   ← BrowserWindow 创建、Hono 启动、IPC 注册
│  ├─ preload.ts                ← contextBridge:暴露给 renderer 的 native API
│  ├─ services/
│  │  ├─ fs.ts                  ← 路径越权防护 + chokidar watcher
│  │  ├─ keychain.ts            ← keytar wrap
│  │  ├─ git.ts                 ← 探测 / status / branch(只读)
│  │  ├─ dialog.ts              ← 选文件夹 / 选文件
│  │  └─ hono.ts                ← 启动 Hono(import 现有 server/index.ts)
│  └─ ipc.ts                    ← 所有 ipcMain.handle 集中注册
├─ server/                      ← 现有,几乎 0 改动
├─ src/                         ← 现有,主要改 store/files.ts 加 dispatcher
│  ├─ native/
│  │  ├─ types.ts               ← Native API contract
│  │  └─ index.ts               ← detectEnv():browser vs electron
│  └─ store/files.ts            ← 改为 dispatcher
├─ package.json                 ← 加 electron / electron-builder / chokidar / keytar
└─ electron-builder.yml         ← 打包配置
```

---

## Sprint 拆分

### Sprint 6.0a — Electron 启动 + Hono in-process(2-3 天)

**目标:`pnpm electron:dev` 起来一个窗口,Hono 在内部跑,renderer 跑现有 React 代码。**

1. `pnpm add -D electron electron-builder @types/electron`
2. `electron/main.ts`:创建 BrowserWindow,加载 `http://localhost:5173`(dev)或 `dist/index.html`(prod)
3. `electron/services/hono.ts`:`import { startServer } from '../../server/index'`(需要把 server 改成可被 import,不是直接监听 5174;暴露 `startServer(port?, token?)`)
4. main 启动时:`const { port, token } = await startServer({ port: 0 })`(0 = OS 分配)
5. `electron/preload.ts`:`contextBridge.exposeInMainWorld('aiDesignNative', { hono: { baseUrl, token } })`
6. renderer 的 `ClientProvider` 改成读 `window.aiDesignNative?.hono?.baseUrl ?? '/api/llm/chat'`(浏览器环境 fallback 到老路径)
7. `package.json` 加脚本:`"electron:dev": "concurrently 'pnpm dev:client' 'pnpm dev:server-watch' 'wait-on http://localhost:5173 && electron .'"`

**验收**:`pnpm electron:dev` 出窗口,能新建项目(还是 IDB)聊天 AI 写文件 iframe 预览(还是 SW),跟浏览器版行为完全一致。**v6.0a 只是把现状装进 Electron**,功能没动。

### Sprint 6.0b — 文件 dispatcher + 选本地文件夹(3-4 天)

**目标:用户能选一个本地文件夹,AI 写的文件真的落到磁盘。**

1. `src/native/types.ts`:定义 contract
   ```ts
   interface NativeFs {
     readFile(rootPath, relPath): Promise<{content, type, size}>
     writeFile(rootPath, relPath, content, type): Promise<void>
     listFiles(rootPath): Promise<{path, type, size}[]>
     deleteFile(rootPath, paths: string[]): Promise<void>
     // ↑ 内部做路径越权检查
   }
   interface NativeAPI {
     fs: NativeFs;
     dialog: { pickDirectory(): Promise<string|null> };
     hono: { baseUrl, token };
   }
   ```
2. `electron/services/fs.ts`:实现 + 路径越权防护
   ```ts
   function resolveSafe(rootPath, relPath) {
     const abs = path.resolve(rootPath, relPath);
     if (!abs.startsWith(rootPath + path.sep) && abs !== rootPath) throw new Error('path escape');
     return abs;
   }
   ```
3. `electron/ipc.ts`:`ipcMain.handle('fs:read', ...)` 等
4. `electron/preload.ts`:暴露 `window.aiDesignNative.fs.*`
5. `src/store/db.ts`:`projects` 表加 `rootPath: string | null` 字段(IDB 升 schema 版本)
6. `src/store/files.ts`:改成 dispatcher
   ```ts
   export async function readFile(projectId, path) {
     const proj = await db.projects.get(projectId);
     if (proj?.rootPath && window.aiDesignNative) {
       const f = await window.aiDesignNative.fs.readFile(proj.rootPath, path);
       return { projectId, path, content: f.content, type: f.type, mtime: Date.now() };
     }
     return db.files.where({ projectId, path }).first(); // 老 IDB 路径
   }
   // 其它 CRUD 类推
   ```
7. 项目创建对话框:加"选本地文件夹"按钮 → 调 `dialog.pickDirectory` → 把返回路径存到 `projects.rootPath`
8. FileTree 组件不需要改,因为 listFiles 已经 dispatcher 化了

**验收**:
- 浏览器版老项目:继续 IDB,行为不变
- 选本地文件夹新建项目:AI write_file 真落盘,Finder 打开能看到;关 App 再开,文件还在
- 写 `../../../etc/passwd` 被拒绝

### Sprint 6.0c — 预览切到 localhost server(2-3 天)

**目标:iframe 不再走 SW + IDB,改走 Hono 提供的项目静态服务。**

1. `server/preview-router.ts`:新建一个 Hono router,挂在 Hono 的 `/preview/<projectId>/*`
2. router 逻辑:查 projectId → 拿 rootPath → 从磁盘读文件 → 返回(HTML 自动注入 `__aid_inject.js` 和 `window.__previewProjectId`,与 SW 行为一致)
3. 老 IDB 项目:router 还是走 IDB(检测 rootPath 为 null 时)—— 兼容
4. `src/preview/injectBuilder.ts`:`previewUrl` 改成基于 `window.aiDesignNative.hono.baseUrl`,fallback 到 SW path
5. SW 注册逻辑:Electron 环境跳过(`if (!window.aiDesignNative) navigator.serviceWorker.register(...)`)
6. iframe `src` 自动用新 URL

**验收**:本地文件夹项目预览正常;改一个 CSS 然后 `refreshKey++` 能看到新内容;`__aid_inject.js` 注入正常,inspect/edit 都能用。

### Sprint 6.0d — 文件 watcher 双向同步(3-4 天)

**目标:用户在 VSCode 改文件 → ai-design 自动刷新预览 + 通知 AI。**

1. `pnpm add chokidar`
2. `electron/services/fs.ts`:加 `watchProject(rootPath, callback)`
   - chokidar.watch(rootPath, { ignored: /node_modules|\.git|\.ai-design/, ignoreInitial: true })
   - 事件:add / change / unlink → callback({type, path})
3. main 在项目激活时开启 watcher;切项目时关
4. IPC 把事件 forward 到 renderer:`webContents.send('fs:change', event)`
5. renderer 监听 `fs:change`:
   - **去抖 + AI 回声防护**:维护一个 `recentAIWrites: Map<path, timestamp>`,write_file 完成时打标记;chokidar 事件 < 1 秒内的同路径忽略(那是 AI 自己刚写的回声)
   - 通过去抖的事件:① 触发预览刷新(refreshKey++)② push 一条 userActionBuffer 动作 `external_edit{path, before, after}`(diff 短就带 before/after,长就只带 path)
6. UI:外部改动出现时,chat 顶部短暂显示 "📂 styles.css 被外部修改" toast(2s 后自动消失)

**验收**:
- 在 VSCode 改 styles.css 保存 → 1 秒内预览自动刷新
- 下次给 AI 发消息,user message 前面带 `[外部改动:styles.css 1 处]`,AI 知道这事
- AI 自己 write_file 不会触发"外部改动"通知(回声防护)

### Sprint 6.0e — API key 迁 keytar + 项目持久化(2 天)

**目标:API key 离开 renderer 进 OS keychain;关闭 App 不丢配置。**

1. `pnpm add keytar`
2. `electron/services/keychain.ts`:
   ```ts
   getKey(provider): Promise<string|null>  // keytar.getPassword('ai-design', provider)
   setKey(provider, key): Promise<void>
   deleteKey(provider): Promise<void>
   ```
3. IPC `key:get` / `key:set` / `key:delete`
4. renderer `src/settings/secrets.ts`:Electron 环境走 IPC,浏览器环境保留 Web Crypto 流程
5. ModelSettings UI:Electron 下显示 "已存入系统钥匙串",删除按钮明显;不再每次开 tab 让用户重输

**验收**:
- macOS:Keychain Access.app 里能看到 "ai-design" 条目,密码 redacted
- 重启 App,API key 自动还在
- 卸载 App 后 keychain 条目保留(用户在 Keychain Access 手动删)

### Sprint 6.0f — Git 状态(只读)(2 天)

**目标:header 显示分支 + 改动数;AI 多一个 `git_status` 工具。**

1. `electron/services/git.ts`:用 `simple-git` 或者直接 `execFile('git', [...])`
   - `detectRepo(path)`: `git rev-parse --is-inside-work-tree`
   - `getStatus(path)`: `git status --porcelain` 解析成 `{path, status: 'M'|'A'|'D'|'??'}[]`
   - `getBranch(path)`: `git rev-parse --abbrev-ref HEAD`
2. IPC `git:status` / `git:branch`
3. Shell header 旁加 `<GitStatusBadge>`:`main · 3 changed`
4. FileTree 旁标 dirty 文件:M(orange)/ ??(blue)/ D(red)
5. `src/llm/tools.ts` 加 `git_status` client 工具(仅 Electron 注册)
   - LLM 拿到 dirty files 列表 + branch,可以"先看看用户已经改了啥再动手"
6. system prompt 短文档化这个工具

**验收**:
- 在 git 仓库里跑,header 显示分支 + 3 changed
- FileTree 里 dirty 文件有色块
- AI 调 `git_status` 能拿到 `[{path: 'src/foo.ts', status: 'M'}, ...]`

### Sprint 6.0g — 打包发布(2-3 天)

1. `electron-builder.yml`:
   - mac:dmg + zip,arm64 + x64
   - win:nsis + portable
   - linux:AppImage + deb
2. 应用图标(可暂用占位)
3. codesign(macOS 需要 Apple Developer 证书 $99/年;先 ad-hoc 签让自己用)
4. `pnpm dist:mac` / `pnpm dist:win`
5. README 加"安装包下载"段
6. GitHub Release 自动化(可放 v6.1)

**验收**:
- macOS `pnpm dist:mac` 出 .dmg,装上能跑
- 应用菜单 / 关于框 正常

---

## 安全模型(README 必须写)

| 威胁 | 缓解 |
|---|---|
| AI 写文件越权(`../../`) | fs 服务层 `resolveSafe` 拒绝 |
| 用户误改的 path 跨项目根 | dialog.pickDirectory 之外的路径不接受 |
| 第三方 LLM 网关泄露 key | key 存 keychain,只在调用瞬间从 main 读出来过 IPC 给 LLM 调用;renderer 永远拿不到 |
| iframe 加载 AI 写的恶意 JS | iframe sandbox + Hono server 同 127.0.0.1 但**不**与 main API 同源(Hono 跑在另一个 port,带 Authorization token 鉴权);AI 写的 JS 无法 fetch `/api/key` |
| 用户文件被 AI 误删 | `delete_file` 工具保留;snapshot 回滚机制覆盖 |
| 不要做的 | 不让 AI 跑 shell;不让 AI commit/push;不让 AI 读项目根外的文件 |

---

## 不在 v6.0 范围(明确 out-of-scope)

- ❌ AI 跑 `npm run dev`(B4)— v6.2+
- ❌ AI 内置编辑器(用户用 VSCode)
- ❌ AI 跑 git commit / push / merge / rebase(F3+)
- ❌ 多文件夹 workspace(VSCode multi-root style)
- ❌ 远程 SSH / Codespaces 接入
- ❌ Tauri 重写(v6.5+ 看用户量再评估)

---

## 工时估算

| Sprint | 工时 | 累计 |
|---|---|---|
| 6.0a 启动 + Hono | 2-3 天 | 3 天 |
| 6.0b fs dispatcher + 选目录 | 3-4 天 | 7 天 |
| 6.0c 预览切 localhost | 2-3 天 | 10 天 |
| 6.0d 文件 watcher | 3-4 天 | 14 天 |
| 6.0e keytar + 持久化 | 2 天 | 16 天 |
| 6.0f git 状态 | 2 天 | 18 天 |
| 6.0g 打包发布 | 2-3 天 | 21 天 |

**总计:3 周左右**(单人专心写,含联调和踩坑;并发干其他事拉到 4-5 周)。

---

## 立即开始 — 6.0a 第一步

```bash
pnpm add -D electron electron-builder wait-on
mkdir -p electron/services
```

然后写 `electron/main.ts` + `electron/preload.ts` + 改 `server/index.ts` 暴露 `startServer({port, token})`。
