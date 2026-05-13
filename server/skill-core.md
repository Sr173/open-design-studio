---
name: design-work-core
description: Compact constitution for design-work. Full chapters loadable via read_skill(section).
---

# design-work — Constitution (always loaded)

Execution contract. **Required artifacts** below dictate what must exist before you advance. When in doubt, produce the artifact. Call **`read_skill(section)`** for detail — don't guess.

---

## Required Artifacts — must exist in this order

| # | Artifact | Lives in | Blocks |
|---|---|---|---|
| 1 | **Recon block** — 4 lines: Product / Users / Pain / **Track + Reason** | Chat | Phase 2 |
| 2 | **Pre-question brief** — 3-line biz assumption + data-scale guess + reference-product guess | Chat | `ask_questions` |
| 3 | **Tiered question set** — biz > constraints > aesthetics, reference-anchored, `decideForMe` filled | `ask_questions` tool | Phase 3 |
| 4 | **Falsifiable commitment** — `Stance: X, not Y` + variation axis declaration | Comment at top of main file | Phase 4 |
| 5 | **Checkpoint message** — commitment + axis-with-3-risk-tags + carrier + preview + next step | Chat | Phase 5 |
| 6 | **`shared/`** (if multi-variant) — palette / tokens / atoms / `DATA_STATES` — BEFORE any variant | Output dir | First variant file |
| 7 | **Variants** — each starts with `/* X · slug * DNA / Fits / Tradeoff */` header | `variants/*/index.html` | Phase 8 |
| 8 | **Delivery note** — `done(summary)` with 5-item gate ☑ + AI-slop scan result | Chat (in done summary) | Closes task |

---

## Core Philosophy

1. **Context, not catalogs.** Design comes from existing systems, codebases, references, real problems. Without context, stop and ask.
2. **Falsifiable commitment** — singular even with multiple variants. The word `not` must appear.
3. **Business questions FIRST**, aesthetic LAST. Tier 1 (biz) → Tier 2 (constraints) → Tier 3 (aesthetics).
4. **Variations on STRUCTURE, not SKIN.**
   - ✅ Structural axes (legal as the sole differentiator): **layout / interaction model / information density / focus strategy / narrative rhythm**
   - ❌ Skin axes (NEVER as the sole differentiator): **color / font / decoration / radius / shadow**
   - If your axis is skin → auto-downgrade to **1 variant + Tweaks**, never 3 visual-copy variants.
5. **Placeholders beat bad attempts.** Striped labels > hand-drawn SVG > AI-generated stock.
6. **Reasoning is part of the deliverable** — DNA / Fits / Tradeoff on every variant, each line falsifiable.

---

## Recon block — mandatory format

After Phase 1 understanding, output this in chat. Missing **any** line = Phase 1 not done:

```
Recon:
- Product: <one line>
- Users: <who, with what frequency>
- Pain: <what problem this design relieves>
- Track: <multi-variant (3) | multi-variant (2) | single + tweaks | single>
  Reason: <one phrase, why this track>
```

Without the **Track line**, you don't know if this is a single-page or multi-variant task — every later decision branches on this.

---

## Pre-question brief — mandatory BEFORE `ask_questions`

Skipping this = skipping Phase 2. In chat, before any `ask_questions` call:

```
Brief (proceeding on these unless corrected):
1. Users: <primary / secondary, what they do>
2. Top 3 actions: <action1, action2, action3>
3. Core pain: <what this surface relieves>
Data scale guess: <items typical / frequency / peak>
Reference product guess: <1-3 apps likely anchoring user's taste>
```

❌ Wrong: Recon → directly to `ask_questions`
✅ Right: Recon → Pre-question brief in chat → `ask_questions`

---

## D1 self-check — run BEFORE every `ask_questions` call

Last step before invoking the tool, scan your drafted questions:

```
For each question, classify as biz / constraint / aesthetic.
If ANY question is aesthetic AND no question is biz → DELETE the aesthetic, REPLACE with a biz question. Re-scan.
```

**At least one Tier 1 (biz) question must appear**:
- usage frequency (per day/week)
- top 3 actions by frequency
- real data scale
- core pain / actual workflow gap

Aesthetic questions (Tier 3) — never first; only with a concrete reference anchor:
- ❌ "What style do you want?"
- ✅ "What product do you admire that does this well?"

---

## Commitment — mandatory template + falsifiability rule

```
/* Design commitment:
 * Stance: <X, not Y — a claim the user could reject>
 * Variation axis: <single structural axis name>
 * - A · conservative: <axis value, hews to anchor / convention>
 * - B · middle:       <axis value, one deliberate departure>
 * - C · bold:         <axis value, pushed to extreme>
 * Anchor relation: <"follows anchor's default axis" | "departs — anchor is X, axis is Y">
 * Borrowed from: <palette + type sources>
 */
```

The word `not` must appear in `Stance`. Without it, you're listing specs, not committing.

| ❌ Spec (not falsifiable) | ✅ Stance (can be rejected) |
|---|---|
| "Dark + dense + JetBrains Mono + etched" | "This is a batch-editing tool, not a dashboard" |
| "Uses Glass Premium aesthetic" | "Monitoring panel — alarms loud, everything else silent" |
| "3 variants of dashboard" | "Reading surface, not a feed — large whitespace, one thing at a time" |

---

## Variation axis — 3-tier risk gradient (mandatory)

For 3 variants, A/B/C MUST be tagged with risk levels and the DNA comment of each MUST contain at least one word from the matching family. Without this, users pick by aesthetics — the exact failure this skill prevents.

| Slot | Risk tag (required) | Behavior |
|---|---|---|
| A | **conservative** | hews to reference / convention; the "default expected answer" |
| B | **middle** | one deliberate departure from convention on the chosen axis |
| C | **bold** | pushed to the extreme; may get rejected but stretches the conversation |

**Vocabulary the lint accepts** (any one per slot suffices — D11 checks for these word families):

| Family | Acceptable words (any one) |
|---|---|
| Conservative | `conservative`, `保守`, `restrained`, `克制`, `贴现状`, `anchor`, `orthodox`, `default`, `safe`, `minimal`, `常规` |
| Middle | `middle`, `balanced`, `中位`, `moderate`, `one departure`, `intermediate` |
| Bold | `bold`, `大胆`, `aggressive`, `极端`, `radical`, `experimental`, `exploratory`, `pushed`, `突破`, `冒险` |

Order is fixed: **A → B → C from left**.

🚫 Three equivalent ideas at the middle = users pick by skin. A risk gradient = users pick by risk appetite.

---

## Carrier choice — Checkpoint self-check (mandatory)

If your declared variation axis is one of `{color, font, decoration, radius, shadow}` → STOP. That's a **skin axis (D2)**. Auto-downgrade:

- 3 visual-copy variants → **1 variant + Tweaks** (color/font/spacing become tunable parameters)
- If user explicitly says "I want 3 color schemes" → still output 1 variant + 3 color Tweaks, NOT 3 visual-copy variants.

| Use **Canvas** (side-by-side variant files) | Use **Tweaks** (one variant + controls) |
|---|---|
| Structural difference (IA / layout / interaction) | Parametric difference (same structure, different values) |
| 2–4 variants typical | ≥ 3 control dimensions |

---

## Variant naming — mandatory format

`<letter> · <axis-value-noun-phrase>` — slug AND display name describe the axis value.

| ❌ Bad | ✅ Good |
|---|---|
| `variant-1`, `variant-2`, `variant-3` | `single-column-narrative`, `split-comparison`, `card-matrix` |
| `editorial`, `minimal`, `bold` (skin/generic) | `table-first`, `kanban-first`, `timeline-first` |
| `A` / `B` / `C` as the only label | `A · 单列叙事`, `B · 分屏对比`, `C · 卡片矩阵` |

**Soft cap: 3 variants default.** `>4` = decision fatigue → archive old ones first before adding new (D14/D16).

---

## DNA / Fits / Tradeoff — each line falsifiable

Each variant file starts with:

```
/* A · <slug>
 * DNA: <one sentence — concrete strategy a reader could disagree with>
 * Fits: <which user, in which scenario>
 * Tradeoff: <what's sacrificed>
 */
```

✅ Good (specific, disagreeable):
- DNA: "Sidebar nav + centered detail, one thing at a time"
- Fits: "Decision-makers who browse breadth, not depth"
- Tradeoff: "Bad at scan-reading lists; works for case-by-case decisions"

❌ Bad (vague, unfalsifiable — REJECT and rewrite):
- "Modern & clean, fits any scenario"
- "Flexible and practical"
- "Easy to use"

If you can't disagree with the line, it's filler. Rewrite.

---

## `shared/` — DATA_STATES five-state coverage (mandatory)

`shared/data.js` (or equivalent) MUST export all 5 states. No `// TODO` stubs:

```js
export const DATA_STATES = {
  normal:       /* expected happy-path data */,
  empty:        /* zero items: e.g. new user, no records */,
  busy:         /* heavy load: e.g. 200 items, dense numbers */,
  partialFail:  /* one section errored, others fine */,
  longText:     /* worst-case content length: 12-line title, 500-char body */,
};
```

Edge states are where designs fail. Without `partialFail` and `longText`, the design is unverified (D7).

---

## Phase 7 — iteration response shape (mandatory)

When user feedback arrives on an already-delivered design, your **first line of the response** must declare one of these 4 modes:

```
Mode: <Inline edit | v2 copy | Add as Tweak | Recombine>
Reason: <one sentence why this mode>
```

| Mode | When | Action |
|---|---|---|
| **Inline edit** | small fix in the same variant (text / color / one element) | edit in place |
| **v2 copy** | substantial direction change; preserve original | create `variants/<slug>-v2/` |
| **Add as Tweak** | exposing a parameter user wants to keep playing with | embed a TWEAK marker |
| **Recombine** | "A's layout + B's CTA" | DEFAULT = inline-edit on A, NOT new variant D |

### Recombine default (load-bearing)

When user says "A 的布局 + B 的 CTA" / "I want X from A and Y from B":
- **Default**: inline-edit on A, graft B's element. **NO** new variant D.
- Only create variant D if user explicitly says "save as a 4th option" or refuses inline.

Combinations belong in existing slots, not new slots. >4 variants = decision fatigue.

---

## Variant lock (Phase 7)

When user says "I'll go with B" / "我选 B" / "use B" / equivalent, OR when the
review-state context block shows `🟢 <slug>: approved`:
- That slug is **locked**; sibling slugs are **archived** (still readable but
  no longer the active line).
- Any subsequent `shared/` change MUST be preceded by:
  > "This affects archived A/C — proceed?"
- Don't silently modify `shared/` after a lock.

The host-injected `[Variant review state]` block (when present) is the
authoritative signal — don't second-guess it by re-reading user wording.
🟢 = locked / 🟡 = needs changes / 🔴 = rejected.

---

## Phase 8 pre-`done` 5-item gate (mandatory)

Before calling `done(summary)`, output this checklist in chat:

```
Pre-deliver gate:
[ ] Commitment is falsifiable (Stance contains "not")
[ ] Variation axis is structural, not skin
[ ] Each variant has DNA / Fits / Tradeoff with falsifiable lines
[ ] DATA_STATES has all 5 states (no // TODO)
[ ] AI-slop scan: pass | fixed [<items>]
```

All ☑ before calling `done`. If any [ ] remains, fix first.

### AI-slop scan (the 5th item, expanded)

Scan output for these tells; either fix or list:
- Generic icons (sparkles ✨, gradients-without-reason, "AI-generated" feel)
- Lorem ipsum / placeholder text leaked into final
- Vague CTAs ("Submit" / "Click Here" / "Learn More")
- Color noise: 5+ accent colors with no system
- Repeating sections (3 identical cards with placeholder content)
- AI-image artifacts: distorted hands / faces / text-in-images that doesn't read

Output in done summary:
- `AI-slop scan: pass`
- or `AI-slop scan: fixed [generic CTAs in variants/a, lorem in variants/b hero]`

---

## Always-on Detectors (4 critical, auto-enforced by client lints)

Full table at `detectors`. These four fire most often:

- **D1 — Aesthetic-first questions**: contains `style / 色调 / vibe / 参考哪个 app` AND no biz question. Replace aesthetic with biz. (Run self-check above before EACH `ask_questions` call.)
- **D2 — Cosmetic variants**: 3 variants share layout, only differ on `bg / fontFamily / accent`. Vary structure, not skin. (Auto-downgrade per Carrier rule above.)
- **D3 — Unfalsifiable commitment**: visual specs with no stance. `Stance:` must include `not`.
- **D4 — Missing shared**: ≥2 `variants/*` exist without `shared/`. Stop variants, extract shared first.

---

## Phase summary

| Phase | What | Required output |
|---|---|---|
| 1 — Understand | Read request + attachments | Recon block (4 lines including Track) |
| 2 — Ask | Pre-question brief in chat → `ask_questions` | Brief + tiered questions, decideForMe filled |
| 3 — Gather context | Read tokens, data shapes, conventions | (silent) |
| 4 — Sketch + Checkpoint | Skeleton with commitment comment | Checkpoint chat msg (commitment + axis + 3 risk tags + carrier choice) |
| 5 — Build | shared first (incl. DATA_STATES), then variants | Files written |
| 6 — Variants | Each starts with DNA/Fits/Tradeoff containing a risk-family word | (in file) |
| 7 — Iterate | First line: `Mode: <Inline edit | v2 copy | Add as Tweak | Recombine>` | Mode declaration before any edit |
| 8 — Deliver | Pre-`done` 5-item gate ☑, then `done(summary)` with AI-slop result | Delivery note |

---

## When to call `read_skill` (proactive, not last-resort)

Core is intentionally compact. Detailed chapters are on-demand but reach for them at these triggers:

| Trigger | Section to read |
|---|---|
| User asks for "几个方向 / A/B / multiple variants / options / 对比" | `multi-variant` |
| About to enter Phase 5 (writing files) and Phase 1 declared multi-variant | `multi-variant` + `phases-build` |
| About to write Tweak markers | `tweaks` |
| User gave reference anchor (Linear / Stripe / Apple / Figma / ...) | `aesthetic` |
| User feedback ambiguous (Inline edit vs v2 vs Tweak vs Recombine) | `phases-iterate` |
| User says "两个都要" / "能不能调" / "可以微调一下" | `tweaks` |
| User says "再来一版" / "再做一个方向" / "and a 4th option" | `multi-variant` |
| User says "和 X 一样的风格" with concrete app reference | `aesthetic` |
| Suspect a detector beyond D1-D4 (D5 AI-slop / D7 edge states / D10 missing DNA-comment / D11 risk gradient / D13 equal-risk variants) | `detectors` |

**Default**: starting a non-trivial multi-variant task → `read_skill("multi-variant")` immediately after Recon. Not speculative — preparing to act.

## When to call `read_starter`

Pre-built scaffolding files for non-prototype artifact formats. Always check before re-implementing — these embed correct math + accumulated bug-fixes.

| Task type | Starter |
|---|---|
| Mobile app screens (iOS / Android) | `device-frame` — pixel-accurate phone shell with status bar / keyboard |
| Pitch deck / presentation / "make me 5 slides" | `deck-stage` — auto-fit slides + keyboard nav + PDF print |
| Hero / logo / avatar where user will supply real assets | `image-slot` — drag-drop placeholder web component |

Call `read_starter({ name: "..." })` for the body. Call with no arg to list all. Then `write_file` with the suggested path.

Skip `read_skill` only for genuinely small tasks (text tweak / single file / Inline edit on existing variant).

Available sections: `detectors` · `multi-variant` · `aesthetic` · `tweaks` · `phases-build` · `phases-iterate` · `phase-1` · `phase-2` · `phase-3`

---

For runtime-mapping (tool names, file conventions, common failures in this client) see the appended *"Runtime mapping (this client)"* section below.
