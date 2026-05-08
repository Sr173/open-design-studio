---
name: design-work
description: Produce thoughtful, high-fidelity design artifacts in HTML — interactive prototypes, multi-option explorations, slide decks, animated videos, static mocks. This is an execution contract, not a style guide — each phase has required artifacts, and skipping any without explicit reason means the task is not done. Trigger for any design request — "design / redesign / prototype / mock up / explore / A/B / variations" of any UI, page, screen, deck, video, or component.
---

# design-work

**Execution contract for design artifacts.** Core Philosophy explains *why*; Required Artifacts and Phase Outputs dictate *what must exist before you move forward*. When in doubt, produce the artifact.

---

## Required Artifacts — must exist in this order

Every non-trivial design task MUST produce these, in order. **Skipping any without an explicit reason stated in chat = task not done.** Small tweaks may collapse multiple steps, but must still state which.

| # | Artifact | Lives in | Blocks |
|---|---|---|---|
| 1 | **Recon summary** — 3 sentences (what product, who uses it, what pain) + unknowns list | Chat message | Phase 2 |
| 2 | **Pre-question brief** — business assumption (3 sentences) + data scale guess + reference product guess | Chat message | `AskUserQuestion` call |
| 3 | **Tiered question set** — biz > constraints > aesthetics, reference-anchored, defaults pre-filled | `AskUserQuestion` | Phase 3 (unless bounded) |
| 4 | **Design commitment** — single falsifiable stance ("X, not Y"), shared by all variants if multi-variant | Comment at top of main file | Phase 4 |
| 5 | **Checkpoint message** — commitment + variation axis (one structural axis + values per variant) + carrier (Canvas/Tweaks/Hybrid) + preview path + next step | Chat message | Phase 5 build |
| 6 | **`shared.jsx`** (if multi-variant) — chrome, tokens, common atoms extracted BEFORE any variant | Output dir | First `variant-*.jsx` |
| 7 | **Variants** — each file header block `/* DNA / Fits / Tradeoff */` | `variant-*.jsx` files | Phase 8 delivery |
| 8 | **Delivery note** — paths, URL, task_id, per-variant DNA/Fits/Tradeoff, scenario toggles, canvas keys, unresolved items | Chat message | Closes the task |

---

## Core Philosophy

These principles explain *why* each required artifact exists. The artifacts above are the operational form. If you understand the philosophy but skip an artifact, the artifact wins.

### 1. Design comes from context, not catalogs

Hi-fi designs are rooted in existing design systems, codebases, references, real problems. **Catalogs of "14 design movements" are vocabulary for describing what you made, not menus for picking what to make.** Without context, stop and ask.

→ enforced by Artifact 1 (recon) + 2 (pre-question brief) + 3 (tiered questions).

### 2. Commitment is a falsifiable stance, not a spec

"This is a batch-editing tool, not a dashboard" can be wrong. "Dark + dense + JetBrains Mono" can't be wrong — it's just a description. Commitments must be **claims a user could reject**.

**Commitment is singular, even when there are multiple variants.** Three commitments = three products = nothing to compare. One commitment + one axis with multiple values = real comparison.

→ enforced by Artifact 4 + detectors D3, D11.

### 3. Questions serve business understanding, not aesthetic preference

Business questions first (who uses this, how often, what 3 actions). Aesthetics last. Front-loading "Linear-style or glassmorphic?" is designing backwards.

→ enforced by Artifact 3's tier ordering + detector D1.

### 4. Variations share aesthetic DNA, differ on structure

Three variants with three palettes + three type systems = three products, not three comparisons. The user should compare *layout / interaction / density*, not skin.

→ enforced by Artifact 6 (shared.jsx) + Artifact 7 (DNA comment) + detector D2.

### 5. Placeholders beat bad attempts

Labeled stripes > hand-drawn SVGs of people. Always.

### 6. Reasoning is part of the deliverable

Without DNA/Fits/Tradeoff commentary users pick the prettiest; with it they pick the right one.

→ enforced by Artifact 7 (header block) + Artifact 8 (delivery note).

---

## Input: minimum viable context

Before Phase 1, confirm at least one of these exists. If none, Phase 1's recon concludes "need more input" and halts.

| Minimum viable input | What it gives you |
|---|---|
| A design system or UI kit | Components, tokens, visual language |
| An existing codebase or repo | Real data shapes, real patterns, real constraints |
| Screenshots of current UI | Pattern vocabulary, density, hierarchy |
| Reference products/competitors | Aesthetic anchors, interaction precedents |
| A detailed written brief | Goals, users, edge cases, priorities |
| A napkin sketch or wireframe | Intent and rough layout |

"Just make me something nice" or a logo + product name is NOT enough. Push back and offer to help gather it.

---

## Output: artifact format selection

| Artifact | When | Format |
|---|---|---|
| **Interactive prototype** | Flows, multi-screen UX | React 18 UMD + Babel Standalone in one HTML |
| **Design canvas** (side-by-side options) | 2+ visual directions of same surface | `canvas.jsx` shipped with this skill |
| **Slide deck** | Presentations | One HTML, `<section>` per slide |
| **Animated video** | Motion studies | CSS/JS keyframes inline |
| **Static hi-fi mock** | One screen, no interaction | One HTML file |
| **Storyboard / wireframe** | Early ideation | Grid of simple frames |

**Only `canvas.jsx` ships as a starter.** For other types, write minimal inline HTML — do not pretend to import non-existent starters.

Descriptive filenames: `Onboarding Flow.html` not `prototype.html`. Iterate via `v2` copies when the change is substantial.

---

## Workflow

**Each phase ends with a `Required output` block. Do not proceed to the next phase until that artifact exists in the specified location.** If you must skip, state the reason in chat.

### Phase 1 — Understand

Read the request + every attachment. Identify product, user, pain, unknowns.

**Required output (Artifact 1, in chat before Phase 2):**

```
Recon:
- Product: <one line>
- Users: <who, with what frequency>
- Pain: <what problem this design addresses>

Unknowns:
- <bullet>
- <bullet>
```

If any W is "unknown", name it; Phase 2 will ask.

**Required output (continued) — variant track decision:**

Decide multi-variant vs single-track **before Phase 2** (so the question set
knows whether to ask "几个方向"):

| Trigger | Action |
|---|---|
| Request contains "几个方向 / A/B / variations / options / 对比 / 选一个" | Multi-variant, default 3 |
| Exploratory request ("做个 X" / "redesign Y" / "explore") with no prior artifact | **Default multi-variant, 3 variants** |
| Small tweak / bug-fix / copy change to existing artifact | **Single-track always** — never variant a tweak |
| Request contains "就这样改 / 直接 / 给我一个 / just do it" | Single-track |
| Modification to an existing variant in place | Single-track on that variant |

**Variant count cap:** default **3**. **>4 = variant fatigue** (user can't
evaluate each); **<2 = no comparison signal**.

**Variant count auto-adjusts on user engagement** (Phase 1 → after Phase 2 answers come back):

| User engagement | Track |
|---|---|
| Specific answers to ≥4 questions (high signal) | **3 variants** (full canvas) |
| Specific answers on 2–3, rest "Decide for me" | **2 variants** (focused dichotomy) |
| ≥4 "Decide for me" / no aesthetic anchor / no biz specifics | **1 + Tweaks** — user delegated decision; give one well-reasoned solution + Tweak controls for fine-tuning. Don't push the choice back. |

The "Decide for me" flag isn't an excuse for AI to skip Phase 4 commitment —
it just shifts the deliverable from "comparison" to "best guess + adjustability".

State the decision in the recon block (post-Phase 2):

```
Track: multi-variant (3) | multi-variant (2) | single + tweaks | single
Reason: <one phrase, including engagement signal>
```

### Phase 2 — Ask

**Required output BEFORE calling `AskUserQuestion` (Artifact 2, in chat):**

```
I will proceed on these assumptions unless corrected:
1. <primary / secondary users and what they do>
2. <top 3 actions on this surface>
3. <core pain this surface must relieve>

Data scale guess: <items typical / frequency / peak>
Reference product guess: <1-3 apps likely anchoring user's taste>
```

Then construct questions from the **unknowns** (not from a template), tiered:

- **Tier 1 — Business** (always first if any unknown): usage frequency (per day/week), top 3 actions by frequency, real data scale, true empty/failure rate, core pain, scope. These are **quantitative facts the user knows, not preferences** — without them every direction is a guess, and asking "什么风格" before them is designing backwards.
- **Tier 2 — Constraints**: stack, size, must-haves, existing patterns
- **Tier 3 — Aesthetics** (always last): density, temperature, **reference anchors** — one product they admire for doing this well, one they want to avoid looking like. A concrete anchor collapses 30 minutes of aesthetic Q&A into one answer; abstract adjectives ("现代", "简洁") don't.

**Self-check before invoking `AskUserQuestion`** — detector D1:
> Scan question list. IF any question contains aesthetic words (`style / 色调 / 密度 / vibe / 参考哪个 app`) AND no question asks about `usage frequency / top 3 actions / 核心痛点 / 每天几次` — DELETE the aesthetic question, REPLACE with a business question. Re-scan.

**Required output (Artifact 3):** `AskUserQuestion` call with tiered questions, defaults pre-filled from recon, "Decide for me" option present where sensible.

**Question count is determined by the unknowns list, not a template.** 0 / 1 / 2 / 3 rounds as needed. Skip Phase 2 entirely when the request is fully specified or is a small tweak to prior work (but still produce Artifact 1).

### Phase 3 — Gather context

Read the materials the user pointed to. Extract:

- **Tokens** — hex codes, spacing scale, font stack, radius (from `tailwind.config.*`, `theme.ts`, `tokens.css`)
- **Real data shapes** — from the codebase
- **Frame defaults** — `tauri.conf.json`, Electron `main.*`, `vite.config.*`
- **Conventions** — `CLAUDE.md`, `README.md`, `docs/`
- **UI native language** — menus, labels, comments

> ⚠️ **Recon is context, not constraint.** Scanned tokens describe the current state; they do not fence the new design. Continuity vs break is a question to ask, not a default to assume.

**Required output (Artifact 4):** `design commitment` comment at top of main file.

Commitment must be a **falsifiable stance** — detector D3:

| ❌ Spec (not falsifiable) | ✅ Stance (can be wrong) |
|---|---|
| "深色 + 密集 + JetBrains Mono + etched" | "这是批量编辑工具,不是仪表盘" |
| "Uses Glass Premium aesthetic" | "监控面板 — 异常大声,其他都安静" |
| "3 variants of dashboard" | "阅读界面,不是信息流 — 大留白,一次一件" |

Format:

```
/* Design commitment:
 * Stance: <X, not Y — user could reject this>
 * Variation axis: <what differs across A/B/C>
 * Borrowed from: <palette + type sources>
 */
```

### Phase 4 — Sketch + Checkpoint

Write skeleton of main file: commitment at top, labeled regions, placeholder copy (`[ hero image ]` stripes). No visuals yet.

**Commitment is singular, not plural.** This is the most common collapse:

| ❌ Three commitments (= no commitment) | ✅ One commitment + variation axis |
|---|---|
| "三个变体分别是 editorial / minimal / bold" | "高客单价房产 SaaS 的信任建立页面;变体在「证据呈现节奏」轴上展开" |
| "A 是 dark / B 是 light / C 是 colorful" | "批量编辑工具,不是仪表盘;变体在「主操作位」轴上展开" |

Three commitments = three products = no comparison.
**One commitment + multiple values along one axis = real comparison.**

#### Variation axis — what's allowed to vary, what's not (multi-variant only)

Choose **one structural axis**. Variants take different values on that axis,
share everything else.

✅ **Structural axes** (legal as the sole variation):
- Information architecture / layout (single-column · split · sidebar)
- Interaction model (form-driven · guided · canvas)
- Information density (sparse · balanced · dense)
- Focus strategy (overview-first · detail-first)
- Narrative rhythm / section ordering

❌ **Skin axis** (NEVER as the sole variation — D2 fires):
- Color / font / decoration / radius / shadow

Skin can secondarily *flavor* a variant ("the dense one feels colder, the sparse
one warmer"), but if A/B/C only differ on skin → redo on a structural axis.

**Constants across variants** (lest they become three different products):
- Palette base tone (saturation/brightness can drift slightly; primary hue can't flip)
- Typography pairing (display + body the same pair)
- Decoration register (all decorated, or all restrained — not mixed)

#### Risk gradient — variants are a risk ladder, not 3 equivalent ideas

| Slot | Stance | Behavior |
|---|---|---|
| **A · 保守** | Hew to reference / existing convention. No risk. | The "default expected answer" — anchors the user's evaluation |
| **B · 中位** | One deliberate departure from convention on the chosen axis. Other dimensions stay normal. | Most "shippable" option |
| **C · 大胆** | Push the axis to the extreme. May get rejected, but expands the user's notion of what's possible. | Stretches the conversation |

**Order is fixed: A → B → C, conservative on the left.** Users see the anchor
first, then decide how far right they want to go.

🚫 Three equivalent ideas at the middle of the axis = users pick by skin (vibes).
A risk gradient = users pick by their own risk appetite. — D13 fires.

#### Anchor → axis (cold-start helper, not lock-in)

When Phase 2 surfaced a reference anchor, the *typical* axis the anchor
embodies is below. Use as a starting hypothesis, not as a constraint.

| Anchor | Implied axis |
|---|---|
| Linear | density / operation cadence (sparse-fast vs balanced-fast) |
| Stripe | trust-building rhythm (proof-first vs value-first vs feature-first) |
| Notion | onboarding gradient (guided vs free-form vs template) |
| Ramp | decision aid (raw-data vs interpreted vs prescriptive) |
| Vercel | technical visibility (code-forward vs metaphor-forward) |
| Apple | story rhythm (single-claim vs cumulative vs experiential) |
| Arc | interaction model (orthodox-tabs vs spatial vs command) |
| Figma | canvas density (centered-tool vs panels-everywhere) |

In commitment, declare the axis explicitly and *say if you're departing from
the anchor's default axis*. Example:

> "Reference Stripe, but the variation axis is **evidence-display rhythm**
> (proof-first / interleaved / value-first), not Stripe's default
> value-establishment rhythm."

#### Variant naming — labels must surface the axis

The variant **slug AND display name** must describe the axis value, not
generic skin words.

| ❌ Weak | ✅ Strong |
|---|---|
| `variant-1` / `variant-2` / `variant-3` | `single-column-narrative` / `split-comparison` / `card-matrix` |
| `editorial` / `minimal` / `bold` (skin) | `table-first` / `kanban-first` / `timeline-first` |
| `A · Variant 1` | `A · 单列叙事 (slow)` |

Format: `<letter> · <axis-value>[ · (variant marker)]`. Reading three labels
should reveal the variation axis at a glance.

#### Format generalization — variants exist beyond prototype

The shared/variant pattern adapts to non-prototype formats too:

| Format | Shared layer | Variant layer |
|---|---|---|
| **Prototype** (default) | `shared.{jsx,css}` — chrome, tokens, atoms | `variant-*.{jsx,html}` — IA / interaction |
| **Slide deck** | shared `<style>` token block + deck-stage CSS | A/B/C alternative hero pages within one deck, OR three deck files sharing a token css |
| **Animation / motion study** | shared stage geometry + easing curves | Three timelines with different rhythm / motion language |
| **Static mock** | shared token CSS file | Three `<artboard>` regions on one canvas |
| **Wireframe** | (none — wireframe IS the shared layer) | 3 columns side-by-side in one file |

Universal rule: **whenever ≥2 variants exist, there's a shared layer and a
delta layer**, regardless of format.

#### Carrier choice — Canvas vs Tweaks (multi-variant only)

The two are not the same thing. Pick deliberately:

| Use **Canvas** (side-by-side variant files) | Use **Tweaks** (one variant + controls) |
|---|---|
| Structural difference (IA / layout / interaction differs) | Parametric difference (same structure, different values) |
| User compares side-by-side, evaluates each independently | User mixes and matches, finds best combo |
| 2–4 variants typical | When ≥ 3 control dimensions are needed |
| "侧栏式 vs 顶栏式 vs 全屏式" | "density sparse/balanced/dense × accent 4 选 1 × copy 正式/友好" |

Common **hybrid**: 2–3 Canvas variants for structural directions, each variant
internally exposing 2–3 Tweak parameters for fine-tuning.

🚫 **Forbidden**: 3 Canvas variants whose only difference is skin. That's
"1 variant + 1 Tweak". D2 fires.

**Required output (Artifact 5, in chat):**

```
## Checkpoint

Commitment: <single falsifiable stance, X not Y>
Variation axis: <one structural axis, e.g. "证据呈现节奏">
- A · <slug-conservative> (保守): <axis value, hewing to anchor convention>
- B · <slug-middle> (中位): <axis value, one departure from convention>
- C · <slug-bold> (大胆): <axis value, pushed to the extreme>
Anchor relation: <"following anchor's default axis" | "departing — anchor was X, axis is Y">
Carrier: Canvas | Tweaks | Hybrid
Preview: <how user will see it>
Next: I'll flesh out visuals unless you want to shift the shape first.
```

For single-track tasks, omit the variation/carrier lines and write
"Track: single — <reason>" instead.

Do not proceed to Phase 5 until the user acknowledges, or ~2 min pass with no objection.

### Phase 5 — Extract shared, then build

**Multi-variant file-creation order (mandatory, no shortcuts):**

1. `shared.jsx` (or `shared.css`) — palette, font tokens, shared chrome, layout atoms
2. `variant-a.jsx` — imports from shared, only writes the **delta** (the axis value)
3. `variant-b.jsx`
4. `variant-c.jsx`

❌ Forbidden: write `variant-a.jsx` first, then "extract" shared. The first
variant always pollutes shared with its own skin choices, and B/C end up
fighting it. **Shared first is non-negotiable** — this is what D4 enforces.

**Self-check before any `variant-*` file:**
> IF chrome (sidebar / topbar / shell) will be reused across variants — STOP, extract to shared.jsx first.
> IF declaring const `BORDER / PANEL / TEXT / FONT / ACCENT` that variants share — STOP, extract.
> IF writing a component that any variant will reimport — STOP, extract.

**Required output (Artifact 6):** `shared.jsx` exporting chrome + tokens + common atoms to `window`.

Then build each variant. Rules:
- Real data shapes (from Phase 3 recon or invented-plausible) — never Lorem ipsum
- Cover the edge states that matter to this business
- Missing assets → striped placeholder with monospace label — never hand-drawn SVG
- Match product's native language — detector D6
- Split files > 1000 lines

**Cross-variant consistency rules** (multi-variant only):

- **Shared data**: variants pull from the **same** \`DATA_STATES\` object in
  \`shared/data.{js,jsx}\`. No variant invents its own demo data — that breaks
  comparison ("A looks better because it has nicer numbers"). When the user
  switches data state via TweaksDrawer, all variants update together.
- **Responsive independence**: 1280 is the design width; 1024 / 375 rendering
  is each variant's own responsibility. Don't assume a single \`shared/\`
  breakpoint applies to all — different IAs collapse differently.
- **Error isolation**: each variant wraps its render root with try/catch (or
  ErrorBoundary equivalent). One variant throwing must NOT blank-out the
  others — users still need to compare.

### Phase 6 — Variants with commentary

**Required output (Artifact 7) — each `variant-*.{jsx,html}` MUST start with:**

```jsx
/* A · {variation name}
 * DNA: <core strategy in one sentence — concrete, e.g. "侧栏导航 + 详情居中,一次只看一件事">
 * Fits: <which user, in which scenario — one sentence — e.g. "决策者快速浏览,不深入操作">
 * Tradeoff: <what's sacrificed — one sentence — e.g. "列表式扫读弱,适合个案决策">
 */
```

**Each line must be falsifiable** — a user could disagree. Vague filler
("简洁现代,适合各类场景") = no commentary; redo. Without DNA/Fits/Tradeoff,
users pick by color (vibes); with it, users pick by scenario.

**Self-check before Phase 8** — detectors D2 + D10:
> **D2:** Mentally strip all color, font, decoration from A, B, C. IF wireframes still differ meaningfully (different IA / interaction / density) — OK. ELSE variants are cosmetic; redo. Vary layout or interaction, not skin.
> **D10:** Open each variant file. Does the first line block start with `/* A ·` (or B/C/...) and contain DNA / Fits / Tradeoff? IF not, add it. IF the lines are vague/non-falsifiable, rewrite.

### Phase 7 — Iterate

When the user gives feedback, **first sentence in chat** must declare which
mode you're using and **why**. No mode declaration → wrong response, redo.

| Mode | Trigger | Action |
|---|---|---|
| **Inline edit** | Small tweak, no direction shift (color · font size · spacing · copy) | Edit the file in place. No history. |
| **v2 copy** | Substantial direction shift ("太花,换克制点的" / "整个换风格") | Copy to `<name> v2.html`, **rewrite the commitment** in the new file, evolve from there |
| **Add as Tweak** | "这两个都要,能切换吗" / "想能调一调 X" | Add toggle to `TweaksDrawer`, expose the dimension. **Don't create new files.** |

**Required output (in chat, before editing):**

```
我会用「<Inline edit | v2 copy | Add as Tweak>」处理这次修改。
理由:<one sentence — why this mode and not the other two>
```

Common mis-classification:
- "改个颜色" called as v2 → wrong, that's Inline.
- "我要看克制版" called as Inline → wrong, that's v2 (commitment shifted).
- "想随时切换" called as v2 → wrong, that's a Tweak (parametric, not directional).

#### Recombine protocol — "I like A's layout + B's CTA" (multi-variant only)

The most common feedback in multi-variant work isn't "A wins / B wins" — it's
"give me A's X with B's Y". Don't spawn variant D for this.

| User says | Wrong response | Right response |
|---|---|---|
| "I want A's layout but B's CTA" | Generate variant D with that combination → axis explodes | 1. Confirm: "Take A as the base and graft B's CTA, OR keep both and add a 4th?"<br>2. Default: **modify A inline** — port B's CTA section into A. B stays as the contrast.<br>3. Only if user insists "want both", create `variant-a-cta.html` with v2 naming. |

Hard rule: more than 4 variant files at once → **D14 fires**, must retire old
ones before adding new.

#### Variant lock state — "I picked B"

| State | Behavior |
|---|---|
| **Unlocked** (default after delivery) | All variants are "still being evaluated". Modifications: structural changes ask "all variants or just A?"; token-level changes default to `shared/` (affects all). |
| **Locked** (user said "I'll go with B") | A and C archive (canvas marks them grey but keeps them); subsequent edits default to **B only**. User can revive A/C explicitly. |

When locked, future structural changes that touch shared **must** be confirmed
("This will affect the archived A/C too — proceed?"). Silent `shared/` edits
that diverge variant outputs trigger **D15**.

#### Sub-variants — "I like A, give me 3 CTA directions on top of A"

User wants variation *inside* a chosen variant. This is recursive but bounded.

- **Don't** spawn 3 new top-level variant files (variant explosion).
- **Do**: in the chosen variant's file, expose the disputed element as a
  **Tweak** (\`select\` with the 3 CTA options). User cycles in the panel.
- **Limit**: if sub-variants exceed 4, OR a second element starts demanding
  its own sub-variants, escalate back to v2 copy at the top level.

### Phase 8 — Deliver

Launch server + open browser (see Runtime section).

**Required output (Artifact 8, in chat):**

```
## 已生成

路径:<path>
URL:http://localhost:<port>/
Server task_id:<id>  (TaskStop <id> 关 server)

Commitment: <one-sentence stance>

变体(risk gradient A→B→C):
- A · <slug-conservative> — DNA / Fits / Tradeoff
- B · <slug-middle> — DNA / Fits / Tradeoff
- C · <slug-bold> — DNA / Fits / Tradeoff

Tweaks(右下角切换):<场景名 · 做什么用>
Canvas 键盘:滚轮缩放 · 拖空白平移 · ⤢ 全屏 · ←→ 切变体 · ↑↓ 切 section · Esc

未解决(必须列出任何跳过的 artifact 或未回答的问题):
- <item>
```

#### Export policy (when user requests "package this up")

| State | What gets included |
|---|---|
| **No variant locked** | All variants + `shared/` + `data/` (full deliverable for further evaluation) |
| **One variant locked** | Locked variant + `shared/` only. A and C are archived, NOT exported by default. Add explicit "include archived" toggle if user asks. |

Rationale: a locked variant means user has decided. Shipping the rejected
options to a designer / engineer / client adds noise and dilutes the chosen
direction.

---

## Self-Check Detectors

Hard rules that fire automatically. Not judgment calls.

### D1 — Aesthetic-first detector
**Trigger:** questions contain `style / 色调 / 密度 / vibe / feel / 参考哪个 app` AND no question contains `usage frequency / 每天几次 / top 3 actions / 核心痛点`.
**Action:** DELETE aesthetic, ADD business.

### D2 — Cosmetic-variation detector
**Trigger:** 3 variants share layout (same sidebar + topbar + main grid) AND differ only in `background / fontFamily / accent`.
**Action:** Redo. Vary layout / interaction / density, not skin.

### D3 — Unfalsifiable-commitment detector
**Trigger:** commitment has no "X, not Y" structure OR lists only visual specs (fonts / colors / density) with no stance.
**Action:** Rewrite as a claim the user could reject.

### D4 — Missing-shared detector (multi-variant only)
**Trigger:** project has ≥2 `variant-*.{jsx,html}` files AND no `shared.{jsx,css}` (or equivalent token/chrome file).
**Or:** two variants both declare a component named `Sidebar / TopBar / Shell / Header`, OR both declare const like `BORDER / PANEL / TEXT / FONT / ACCENT`.
**Action:** Stop variant work. Extract `shared.{jsx,css}` first; variants reference via `window.*` or import. Never "extract later" — first variant always pollutes shared.

### D5 — AI-slop tell scanner (run before Phase 8)
Flag if any present:
- Inter / Roboto / Arial as hero font
- Purple-to-indigo gradient on white
- Centered hero card + three-icon row (SaaS-landing cliché)
- Rounded container with left-border accent stripe
- `hover: scale(1.02)` on every button
- Hand-drawn SVG illustrations of people/objects
- Emoji used as decorative icons in non-emoji product
- English technical business terms in CJK product (`ORDER BOOK / TICK FEED / COLLECTOR`)
- Real-world metaphor forced onto business with no natural physical counterpart (`auction house` on generic trading UI, `control room` on settings page)
- 3 "variations" differing only in color / font

**Action:** Fix before delivery.

### D6 — Content-language mismatch detector
**Trigger:** Phase 3 identified project language as non-English AND variant UI copy / button labels / tags contain English terms that are not brand names / units / technical ids.
**Action:** Translate.

### D7 — Edge-state coverage detector
**Trigger:** artifact has lists / data / error-prone flows in normal state AND any of { empty · overloaded · partial-failure · long-text } scenario missing.
**Action:** Add DATA_STATES (at least `normal / empty / busy / partialFail / longText`) + TweaksDrawer toggle. `partialFail` (some items ok, some failed) and `longText` (CJK ×1.5, English ×2) are the two AI-generated UIs most consistently skip.

### D10 — Missing variant commentary
**Trigger:** any `variant-*.{jsx,html}` file does NOT begin with a `/* X · name * DNA / Fits / Tradeoff */` block, OR the lines are non-falsifiable filler ("适合各类场景" / "现代简洁" / "灵活实用").
**Action:** Add or rewrite. Each line must be a claim the user could reject — concrete user, concrete scenario, concrete tradeoff.

### D11 — Multi-commitment detector
**Trigger:** Phase 4 commitment block names variants as separate stances ("A 是 X / B 是 Y / C 是 Z") instead of one stance + one axis.
**Action:** Rewrite. One commitment that all variants share. The variation is the **axis**, not the **stance**. Three stances = three products = nothing to compare.

### D12 — Skin-only carrier mismatch
**Trigger:** Carrier was declared `Canvas` (Phase 4 checkpoint) AND the variants only differ along the skin axis (color / font / decoration / radius).
**Action:** Collapse to 1 variant + Tweak controls (the right carrier for parametric difference). Re-pick a structural axis if you really want Canvas.

### D13 — Equal-risk variants (multi-variant only)
**Trigger:** A/B/C cannot be ordered by conservativeness on the variation axis, OR all three cluster at the middle of the axis (no anchor, no extreme).
**Action:** Rebuild C, push it to the axis extreme. Variants must form a risk gradient (保守 → 中位 → 大胆), not three equivalent middle points. Three middle points = users pick by skin.

### D14 — Variant proliferation
**Trigger:** project has more than 4 `variant-*` files (top-level OR `variants/<slug>/index.html`), OR sub-variant Tweak options exceed 4 on the same element.
**Action:** Stop creating new variants. Confirm with user which old variants to retire (archive) or merge before continuing. Variant explosion = user can no longer evaluate any of them.

### D15 — Silent variant divergence
**Trigger:** edits to `shared/` (tokens / chrome / atoms) cause variant outputs to diverge unintentionally — typically because some variant's local override silently masked the shared change.
**Action:** Either consolidate the override back into shared, OR explicitly mark the override with a comment ("// LOCAL OVERRIDE: variant intentionally diverges from shared on X for reason Y"). Silent divergence breaks the comparison contract.

### D16 — Generic variant labels
**Trigger:** any variant uses `Variant 1` / `A` / skin-words like `Editorial` / `Minimal` / `Bold` as its display name.
**Action:** Rename to surface the axis value: `单列叙事 (slow)` / `双栏对照 (balanced)` / `卡片矩阵 (dense)`. Reading the three labels should make the axis obvious without opening files.

---

## Aesthetic guidance

Vocabulary for describing and refining — **NEVER a pre-design menu**. Reach for it during Phase 5 build, not during Phase 2 questions.

### Medium ≠ web. Don't reach for web tropes reflexively.

HTML is your *tool*; your *medium* varies. Slide deck, native-app UI, mobile game overlay, animation stage — these are not web pages. Drifting into centered hero + navbar + three-column feature grid just because you're in an `.html` file is the default failure mode. Embody the relevant expert: animator, UX designer, slide designer, prototyper. Ask "what would this look like if it weren't on the web?" before defaulting to web rhythm.

### Use the full toolkit. Surprise the user.

CSS/HTML/JS/SVG is a huge expressive surface most users don't know the limits of. Reach for `text-wrap: pretty`, CSS Grid, `clip-path`, `mix-blend-mode`, view transitions, OKLCH, `backdrop-filter`, SVG filters, masonry, scroll-driven animations. Generic SaaS is safe and forgettable — **commit to a bold aesthetic direction even if it could be wrong**. "Clean, minimal, professional" is what everyone says they want and no one remembers. Pick a stance that could be rejected.

### Content earns its place. Avoid data slop.

Never pad a design with placeholder stats, decorative icons, dummy sections, or informational filler "to make it feel substantial." Unnecessary numbers / icons / stats = data slop and are an AI-slop tell. If a region feels empty, solve it with layout and composition — not by inventing content. A thousand no's for every yes. Less is more.

If you think the design would benefit from additional sections, pages, or copy, **ask the user** before adding it. The user knows their audience.

### Default when no brand or system given

- **Type:** 1–3 fonts. Display + body pairing. Avoid Inter/Roboto/Arial as hero.
- **Foreground/background:** pick a tone (warm/cool/neutral). Subtly-toned whites and blacks (saturation < 0.02).
- **Accents:** 0–2 additional colors in `oklch`, sharing chroma and lightness.
- **Shapes:** squares, circles, simple geometry.
- **Imagery:** placeholder stripes with monospace labels.

### Typography pairings (vocabulary)

| Feel | Display | Body | UI accent |
|---|---|---|---|
| Restrained tool | Geist Mono Bold | Geist Sans | JetBrains Mono small |
| Editorial | DM Serif Display | Noto Sans | Space Grotesk labels |
| Dark productivity | Archivo Black | Inter / Geist | JetBrains Mono code |
| Collector / premium | Playfair 900 Italic | Noto Serif | Space Grotesk tags |
| Future-mechanical | Bebas Neue | Space Grotesk | JetBrains Mono data |
| Chinese editorial | Noto Serif SC 900 | Noto Sans SC 400 | Space Grotesk for English |

**Pair rule:** contrast in style, agree in proportion.
**CJK rule:** pick CJK font first, pair Latin to it. Inverting makes CJK fall back to system default mid-sentence.

### Reusable decorative atoms

**Radial blur:** `position:absolute; width:400; height:400; border-radius:50%; background:radial-gradient(circle, rgba(...), transparent 70%); filter:blur(40px)`

**Glass card on dark:** `background:rgba(255,255,255,0.12); backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.25); border-radius:12`

**Metallic text:** `background:linear-gradient(180deg, #ede7da, #ceab68, #6b4f1f); -webkit-background-clip:text; -webkit-text-fill-color:transparent`

**Diagonal clip:** `clip-path:polygon(15% 0, 100% 0, 100% 100%, 0% 100%)`

---

## Claude Code Runtime

Concrete implementation for this host. Philosophy is the mind; this is the hands.

### `canvas.jsx` (ships with skill)

Full Figma-style pan/zoom/focus wrapper at `~/.claude/skills/design-work/canvas.jsx`. Exports `DesignCanvas / DCSection / DCArtboard / DCPostIt` to `window`.

```bash
cp ~/.claude/skills/design-work/canvas.jsx <output_dir>/canvas.jsx
```

If the project has its own equivalent `DesignCanvas`, reference it — don't duplicate.

### Directory structure (multi-variant)

```
<output_dir>/
├─ index.html         ← entry
├─ canvas.jsx         ← copied from skill asset
├─ data.jsx           ← DATA_STATES + window export
├─ shared.jsx         ← chrome + tokens + atoms (Artifact 6)
├─ variant-a.jsx      ← imports from shared
├─ variant-b.jsx
├─ variant-c.jsx
└─ README.md          ← optional
```

### `index.html` template

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{artifact name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?{only the fonts used}" rel="stylesheet">
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script type="text/babel" src="canvas.jsx"></script>
<script type="text/babel" src="data.jsx"></script>
<script type="text/babel" src="shared.jsx"></script>
<script type="text/babel" src="variant-a.jsx"></script>
<script type="text/babel" src="variant-b.jsx"></script>
<script type="text/babel" src="variant-c.jsx"></script>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { background: #f0eee9; }</style>
</head>
<body>
<script type="text/babel">
function App() {
  const [tweak, setTweak] = React.useState('normal');
  const data = DATA_STATES[tweak];
  return (
    <>
      <DesignCanvas>
        <DCSection id="main" title="{name}" subtitle="{commitment one-liner}">
          <DCArtboard id="a" label="A · {name}" width={W} height={H}><VariantA data={data}/></DCArtboard>
          <DCArtboard id="b" label="B · {name}" width={W} height={H}><VariantB data={data}/></DCArtboard>
          <DCArtboard id="c" label="C · {name}" width={W} height={H}><VariantC data={data}/></DCArtboard>
        </DCSection>
      </DesignCanvas>
      <TweaksDrawer tweak={tweak} setTweak={setTweak}/>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
</script>
<div id="root"></div>
</body>
</html>
```

### `data.jsx` — real shapes + edge scenarios

Ship at least 4 scenarios so D7 passes and users can stress the design.

```jsx
const DATA_NORMAL        = { /* realistic values from codebase / brief */ };
const DATA_EMPTY         = { /* lists empty, counts 0 — empty state w/ specific guidance, not "暂无数据" */ };
const DATA_BUSY          = { /* 50+ rows, long strings, overflow numbers */ };
const DATA_PARTIAL_FAIL  = { /* some items ok, some failed — most AI-generated UIs skip this state entirely */ };
const DATA_LONG_TEXT     = { /* CJK ×1.5, English ×2 — where layouts quietly break at real-world copy length */ };

const DATA_STATES = {
  normal:      { ...DATA_NORMAL,       __label: '正常' },
  empty:       { ...DATA_EMPTY,        __label: '空' },
  busy:        { ...DATA_BUSY,         __label: '繁忙' },
  partialFail: { ...DATA_PARTIAL_FAIL, __label: '半错' },
  longText:    { ...DATA_LONG_TEXT,    __label: '长文' },
};
const DATA = DATA_STATES.normal;
Object.assign(window, { DATA, DATA_STATES });
```

### `shared.jsx` — Artifact 6 skeleton

```jsx
/* Shared — chrome, tokens, atoms used by all variants.
 * Extracted to keep variation discipline: variants should differ in layout/
 * interaction/density, not in re-implementing the same sidebar three ways.
 */

// tokens
const BORDER = '...';
const PANEL  = '...';
const TEXT   = '...';
const FONT   = "...";

// shared chrome
function Sidebar({ active }) { /* ... */ }
function TopBar({ title, right }) { /* ... */ }

// shared atoms
function Pill({ children, color }) { /* ... */ }
function StatCell({ label, value }) { /* ... */ }

Object.assign(window, { BORDER, PANEL, TEXT, FONT, Sidebar, TopBar, Pill, StatCell });
```

### `TweaksDrawer` — floating toggle panel

```jsx
function TweaksDrawer({ tweak, setTweak }) {
  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
      background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.15)', borderRadius: 10, padding: 12,
      fontFamily: '-apple-system,"PingFang SC","Segoe UI",sans-serif', fontSize: 12,
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.35em', color: 'rgba(0,0,0,0.5)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' }}>场景</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Object.keys(DATA_STATES).map(k => (
          <button key={k} onClick={() => setTweak(k)}
            style={{ padding: '6px 12px', borderRadius: 6, border: 'none',
              background: tweak === k ? '#0f172a' : '#f5f5f5',
              color: tweak === k ? '#fff' : '#333',
              fontSize: 12, fontWeight: tweak === k ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit' }}>{DATA_STATES[k].__label || k}</button>
        ))}
      </div>
    </div>
  );
}
```

Phase 7 "Add a Tweak" extends this drawer with additional toggle groups (palette, density, copy register, sidebar side, etc.) — not new files.

### Variant file conventions

```jsx
/* A · {variation name}
 * DNA: <core idea — one sentence>
 * Fits: <which user / context — one sentence>
 * Tradeoff: <what was sacrificed — one sentence>
 */
function VariantA({ data }) {
  const D = data;
  return (
    <div style={{
      width: W, height: H, position: 'relative', overflow: 'hidden',
      background: '...', fontFamily: FONT,
    }}>
      {/* decorative layer — zIndex < 10 */}
      {/* content layer — zIndex: 10 */}
    </div>
  );
}
Object.assign(window, { VariantA });
```

Hard rules:
- Outermost `<div>` width/height matches `<DCArtboard>`
- `overflow: 'hidden'` on outermost so decoration can bleed
- Decoration `zIndex < 10` (or unset), content `zIndex: 10`
- File ends with `Object.assign(window, { ... })` — each `<script type="text/babel">` block gets its own transpile scope, so cross-file sharing goes through `window`. Forgetting this = `VariantA is not defined` at runtime.
- Inline styles only; chrome imports from `shared.jsx`
- **CRITICAL — never declare `const styles = {...}` at module scope.** Two variant files each doing it will collide on the global and break silently (second file wins; first file's styles vanish). If you want a styles object, prefix with the variant: `const variantAStyles = {...}`. Same rule for any other bare generic name — `const theme / const tokens / const config`. Prefer inline styles to sidestep entirely.
- Don't add a "title screen" to a prototype — center the artifact in the viewport, no landing-page hero chrome

### Auto-launch server (Phase 8)

```bash
port=8765
while lsof -i:$port -sTCP:LISTEN >/dev/null 2>&1; do port=$((port+1)); done
cd <output_dir>
python3 -m http.server $port    # Bash with run_in_background: true
open http://localhost:$port/
```

Report path, URL, port, and `task_id` to the user. Never `durable: true` — servers die with session.

### Canvas keys (include in Artifact 8)

- Scroll / pinch → zoom · Drag empty → pan
- Click ⤢ → fullscreen focus; Focus mode: ← → switch variants, ↑ ↓ switch sections, Esc exit
- Click labels → inline rename
- Edit jsx + refresh browser → live reflect

---

## What NOT to do

- Don't proceed to next phase without the Required output of the current one
- Don't design without context — ask for UI kit / codebase / screenshots / references
- Don't front-load aesthetic questions (D1 catches this)
- Don't produce variations that share layout and differ only in skin (D2)
- Don't write a commitment that's a spec list (D3)
- Don't write variant-a before shared.jsx exists (D4)
- Don't hand-draw illustrations in SVG
- Don't use Lorem ipsum
- Don't sprinkle English technical terms into CJK products for edge (D6)
- Don't force real-world metaphor onto business with no physical counterpart
- Don't disappear the entire design and return with finished output — Phase 4 checkpoint
- Don't deliver variants labeled only `A / B / C` — attach DNA / Fits / Tradeoff
- Don't `scrollIntoView` — breaks preview hosts
- Don't make the user start the http server themselves
- Don't `durable: true` the server
- Don't add a "title screen" to a prototype — center the artifact in the viewport, skip landing-page chrome
- Don't pad with data slop — fabricated stats, decorative icon rows, dummy "feature" sections just to fill space
- Don't bulk-copy design-system folders (>20 files) — targeted copies only, pull the specific components you'll actually use
- Don't default to generic SaaS when no brand is given — commit to a bolder stance, even one that could be rejected
- Don't declare bare `const styles / const theme / const tokens` at module scope across variants (silent cross-file collision; D4's cousin)
- Don't reach for web-page tropes (navbar / centered hero / 3-icon grid) when the artifact isn't a web page
