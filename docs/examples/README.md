# Examples / 示例

Reference outputs Open Design Studio has produced. Each subfolder is a complete `.design/` directory you can browse to see what AI design output looks like.

每个子目录都是一个完整的 `.design/` 输出 — 可以直接浏览看 AI 设计成果长什么样。

---

## `dogfooding-workbench-redesign/`

**Brief**: Redesign Open Design Studio's own workbench UI — 3 variants on the **chat & filetree carrier** axis.

**Brief**: 重新设计 Open Design Studio 自己的工作台 UI — 在「chat 与 filetree 承载形态」轴上展开三个方向。

| Variant | Slug | Risk |
|---|---|---|
| A | `sidebar-companion` | 保守 — 三栏惯例,迁移成本最低 |
| B | `canvas-first-dock` | 中位 — canvas 100% 宽 + 浮动 chat dock + ⌘K 替代 filetree |
| C | `spatial-overlay` | 大胆 — Arc/Figma 极致空间,28px HUD + 抽屉式 chat |

We picked **A · sidebar-companion** as the shipped layout (see screenshot in main README).

我们最终选了 **A · sidebar-companion** 作为发布版布局(见主 README 截图)。

To browse:
```bash
cd docs/examples/dogfooding-workbench-redesign/variants/sidebar-companion
open index.html
# or `python3 -m http.server` then visit localhost
```

To regenerate or modify, copy this folder into a project's `.design/` and Open Design Studio will pick it up:
```bash
mkdir -p ~/my-project/.design
cp -r docs/examples/dogfooding-workbench-redesign/* ~/my-project/.design/
# open Open Design Studio, bind ~/my-project, you'll see all 3 variants in the canvas
```

---

## Adding your own examples

Got a great output you want to share? Open a PR:

1. Copy your `.design/` to `docs/examples/<slug>/`
2. Add an entry above with brief + variant names
3. Include at least the variant index.html files (skip generated assets)
