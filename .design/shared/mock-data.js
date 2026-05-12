// ai-design · shared mock data (density = 3 / medium)
// 8 projects · 2-3 chats each · 12 files · 20 messages w/ 3 tool blocks
// 三变体共享同一份数据,保证对比公平

window.__AID_MOCK__ = {
  user: { name: "雪琪", initial: "X" },

  currentProject: "kanban-redesign",
  currentChat: "c2",
  currentFile: "variants/sidebar-led/index.html",

  projects: [
    {
      id: "kanban-redesign", name: "Kanban 重设计", folder: "~/work/linear-clone",
      active: true, unread: 0,
      chats: [
        { id: "c1", title: "侧栏导航三方案", date: "今天", active: false },
        { id: "c2", title: "卡片密度对比",   date: "今天", active: true  },
        { id: "c3", title: "空状态打磨",     date: "昨天", active: false },
      ],
    },
    {
      id: "saas-landing", name: "SaaS Landing", folder: "~/work/notion-fork",
      unread: 2,
      chats: [
        { id: "c4", title: "Hero 三个方向", date: "周一" },
        { id: "c5", title: "Pricing 表格",  date: "周一" },
      ],
    },
    {
      id: "mobile-onboarding", name: "Mobile Onboarding", folder: "~/work/app-v3",
      chats: [
        { id: "c6", title: "首屏权限请求", date: "上周" },
        { id: "c7", title: "进度条样式",   date: "上周" },
      ],
    },
    {
      id: "dashboard-v2", name: "Dashboard v2",
      chats: [{ id: "c8", title: "指标卡布局", date: "上周" }],
    },
    {
      id: "pricing-page", name: "Pricing 页",
      chats: [{ id: "c9", title: "三档对比", date: "10/12" }],
    },
    {
      id: "email-templates", name: "邮件模板",
      chats: [
        { id: "c10", title: "欢迎邮件", date: "10/08" },
        { id: "c11", title: "对账邮件", date: "10/08" },
      ],
    },
    { id: "icon-set", name: "图标库",
      chats: [{ id: "c12", title: "线性 vs 实心", date: "10/03" }] },
    { id: "docs-site", name: "Docs 站点",
      chats: [{ id: "c13", title: "侧栏树", date: "9/28" }] },
  ],

  files: [
    { path: "shared/styles.css",                            kind: "css",  size: "4.2kb" },
    { path: "shared/mock-data.js",                          kind: "js",   size: "2.1kb" },
    { path: "variants/sidebar-led/index.html",              kind: "html", size: "8.7kb", active: true },
    { path: "variants/canvas-first-dock/index.html",        kind: "html", size: "9.1kb" },
    { path: "variants/spatial-overlay/index.html",          kind: "html", size: "8.4kb" },
    { path: "uploads/reference-linear.png",                 kind: "img",  size: "184kb" },
    { path: "uploads/sketch-v1.jpg",                        kind: "img",  size: "92kb"  },
    { path: "drafts/empty-state.html",                      kind: "html", size: "1.8kb" },
    { path: "drafts/notes.md",                              kind: "md",   size: "640b"  },
    { path: "README.md",                                    kind: "md",   size: "1.2kb" },
    { path: "tweaks.json",                                  kind: "json", size: "320b"  },
    { path: "preview.png",                                  kind: "img",  size: "246kb" },
  ],

  // 一条 chat 的消息序列(密度=3 → 8 条用户可见 + 3 个工具调用块,代表性即可)
  messages: [
    { role: "user", text: "卡片密度对比一下,3 个方向,密一点的我想看看极限。" },
    {
      role: "assistant",
      text: "Recon:Kanban 卡片密度三档对比 — 用户(PM/Dev)每屏需要看到多少卡片是核心矛盾。\n\n先确认 3 件事:",
    },
    { role: "tool", tool: "ask_questions", title: "推到 Questions tab", subtitle: "5 题 · 业务 → 约束 → 美学",
      status: "done", duration: "0.1s" },
    { role: "user", text: "已答。", reply: true },
    {
      role: "assistant",
      text: "好,变化轴:**单卡承载的信息层数**。A 标题+负责人;B + 子任务进度;C + 评论数+附件+blocker。",
    },
    { role: "tool", tool: "write_file", title: "shared/styles.css", subtitle: "4.2 kb · 写入",
      status: "done", duration: "0.4s" },
    { role: "tool", tool: "write_file", title: "variants/sparse/index.html", subtitle: "6.1 kb · 写入",
      status: "running" },
    { role: "user", text: "停一下 — sparse 那版卡片间距给我大一档。" },
    { role: "assistant", text: "收到,改完继续 B/C。已加 Tweak 控件可自己拉。" },
    { role: "user", text: "好。" },
  ],

  // Tweak 控件示例(每变体右下角浮窗可展开)
  tweaks: [
    { id: "card-gap",     label: "卡片间距",      type: "number", value: 12, min: 4, max: 32, unit: "px" },
    { id: "accent-hue",   label: "强调色色相",    type: "color",  value: "#ffa451" },
    { id: "density",      label: "信息密度",      type: "select", value: "balanced", options: ["sparse","balanced","dense"] },
  ],
};
