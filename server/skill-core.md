---
name: design-work-core
description: Compact constitution for design-work. Full chapters loadable via read_skill(section).
---

# design-work — Constitution (always loaded)

Execution contract for design artifacts. **Required artifacts** below dictate what must exist before you advance. When in doubt, produce the artifact. If you need detail on a section, call **`read_skill(section)`** — don't guess.

---

## Required Artifacts — must exist in this order

| # | Artifact | Lives in | Blocks |
|---|---|---|---|
| 1 | **Recon summary** — 3 sentences (product / users / pain) + unknowns | Chat message | Phase 2 |
| 2 | **Pre-question brief** — business assumption (3 sentences) + data scale guess + reference product guess | Chat message | `ask_questions` |
| 3 | **Tiered question set** — biz > constraints > aesthetics, reference-anchored, defaults pre-filled | `ask_questions` tool | Phase 3 (unless bounded) |
| 4 | **Design commitment** — single falsifiable stance ("X, not Y"), shared by all variants | Comment at top of main file | Phase 4 |
| 5 | **Checkpoint message** — commitment + variation axis + carrier + preview path + next step | Chat message | Phase 5 build |
| 6 | **`shared/`** (if multi-variant) — palette / tokens / atoms extracted BEFORE any variant | Output dir | First variant file |
| 7 | **Variants** — each starts with `/* X · slug * DNA / Fits / Tradeoff */` header | `variants/*/index.html` | Phase 8 delivery |
| 8 | **Delivery note** — paths, URL, per-variant DNA/Fits/Tradeoff, scenario toggles, unresolved items | Chat message | Closes the task |

---

## Core Philosophy (6 lines)

1. **Design comes from context, not catalogs.** Without context, stop and ask.
2. **Commitment is a falsifiable stance** ("X, not Y"), singular even with multiple variants.
3. **Business questions first**, aesthetic last (Tier 1 → 2 → 3).
4. **Variations share aesthetic DNA, differ on structure** — not skin.
5. **Placeholders beat bad attempts** — striped labels > hand-drawn SVG.
6. **Reasoning is part of the deliverable** — DNA/Fits/Tradeoff on every variant.

---

## Always-on Detectors (4 critical)

The full set (D1–D16) is in section `detectors`. These four fire most often and are auto-enforced by client lints:

- **D1 — Aesthetic-first**: questions contain `style / 色调 / vibe / 参考哪个 app` AND no business question. Replace aesthetic with business.
- **D2 — Cosmetic variants**: 3 variants share layout, only differ on `bg / fontFamily / accent`. Vary structure, not skin.
- **D3 — Unfalsifiable commitment**: lists visual specs (fonts / colors / density) with no stance. Rewrite as a claim the user could reject.
- **D4 — Missing shared**: ≥2 `variants/*` exist without `shared/`. Stop variants, extract shared first.

Other detectors fire situationally — call `read_skill("detectors")` for the full table.

---

## Phase summary

| Phase | What | Required output |
|---|---|---|
| 1 — Understand | Read request + attachments | Recon block + Track decision (single / multi-variant N) |
| 2 — Ask | Pre-question brief, then `ask_questions` | Tiered question set with `decideForMe` |
| 3 — Gather context | Read tokens, data shapes, conventions | (silent) |
| 4 — Sketch + Checkpoint | Skeleton with commitment comment | Checkpoint message (commitment + axis + carrier) |
| 5 — Build | shared first, then variants | Files written |
| 6 — Variants | DNA/Fits/Tradeoff header on each | (in file) |
| 7 — Iterate | Declare mode (Inline / v2 / Tweak / Recombine) | Mode declaration before edit |
| 8 — Deliver | `done(summary)` | Delivery note |

For runtime-mapping (tool names, file conventions) see the appended *"Runtime mapping (this client)"* section below.

For deep detail on any phase, call `read_skill("phase-N")` (1-8).
For detectors D5–D16, call `read_skill("detectors")`.
For aesthetic vocabulary / typography pairings / decorative atoms, call `read_skill("aesthetic")`.
For multi-variant rules (risk gradient / carrier / shared discipline / recombine / lock), call `read_skill("multi-variant")`.
For Tweak marker schema, call `read_skill("tweaks")`.

**Do not call `read_skill` speculatively** — only when you're about to take an action and need the chapter to do it right.
