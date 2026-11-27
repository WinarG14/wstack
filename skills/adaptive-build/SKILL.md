---
name: adaptive-build
description: Project-agnostic adaptive build and review orchestrator. Runs zero-token Change Impact Analysis to auto-route any repo task (FE, BE, Full-Stack, CLI, scripts) across 3 risk tiers, selecting the lowest-cost, highest-yield mix of ponytail, selective pstack/poteto skills, sol-loop, 2-Model Fast Council, 3-Model Council, zero-cost DOM Geometry Oracle, and Blind Visual & Heuristic UX Critique (catching logic bugs, visual layout defects, and unspoken common-sense UX flaws without stacking redundant tools). Use for "/adaptive-build <task>", "/adaptive-build review <target>", "smart build", "adaptive build", "build and polish this", or when you want risk-based tool selection across development and review.
---

# Adaptive Build & Review (Project-Agnostic 3-Tier Orchestrator)

One skill for both **Development** and **Review** on any codebase. It replaces guesswork and redundant tool stacking with:

1. **Zero-token Change Impact Analysis (`scripts/adaptive_triage.py`)** to classify risk into Tier 1, 2, or 3 before spending tokens.
2. **One role per tool (zero stacking)** across `ponytail`, selective `pstack` skills, `sol-loop`, 2-Model Fast Council, and 3-Model Council, with hard round caps.
3. **Autonomous Visual & Common-Sense UX Inspection** (`scripts/browser_audit.mjs` + `scripts/ui_geometry_audit.js` + blind heuristic critic) so UI layout bugs and unspoken usability flaws are caught before pushing, without the human eyeballing every screen manually.

---

## Step 0: Deterministic Triage (ALWAYS FIRST, USD 0, <2s)

Run the bundled repo-agnostic classifier before coding (with `--no-git-diff --summary "<goal>"`) and again on the real diff before review:

`<skill_dir>` below is the folder that holds this `SKILL.md` (for example `~/.claude/skills/adaptive-build` or `~/.codex/skills/adaptive-build`). On Windows, use `py -3` in place of `python3` (the Windows `python` is often only the Store placeholder).

```bash
python3 <skill_dir>/scripts/adaptive_triage.py \
  --repo <repo_path> --kind <feature|bug|hotfix|refactor|review> --summary "<goal>" \
  [--failed-attempts <n>] [--json]
```

The output ends with a `Not installed:` line when a skill this file calls is missing. For each one, use its row in **If a skill is not installed** below. Never skip the step silently.

Announce in 2 lines: detected **Tier (1/2/3)**, **Stack (FE / BE / Full-Stack / CLI)**, exact tools you will run, and what you are skipping to save tokens.

### The 3 Risk Tiers (Build Mode)

| Tier | Auto-Trigger | Upfront & Build | Review & Verification (Zero Stacking) |
|---|---|---|---|
| **Tier 1: LEAN** (~USD 0.50-3, 2-5 min, auto-start) | 1-4 non-test files, 1 module/directory, low caller fan-out, no API/DB/auth/schema boundary, no async/concurrency primitives, not a hotfix. | Quick local code read. Build with `ponytail` (full): smallest complete diff, reuse existing helpers/components, 1 focused behavior test for non-trivial logic. | Run `ponytail-review` (~USD 0.50-1) OR 1 `sol-loop` (max 2 rounds, stop on nits). If UI files changed: run **Layer 1 (zero-cost DOM Oracle)** + quick **Layer 2 (~USD 0.20 Blind Visual & Heuristic Critic)**. **Skip:** `/pstack:how`, `/architect`, `/statechart`, `/interrogate`, `/council`. |
| **Tier 2: TARGETED RIGOR** (~USD 4-10, 8-15 min, auto-start with 1-line heads-up) | **ANY 1:** shared module with >=2 caller modules, API/schema/DB/auth/config boundary, 5-14 files, bug fix or production hotfix, async/timers/streaming/concurrency, or multi-state interactive UI. | **Fuzzy brief?** Run `/pstack:reframe` + `/pstack:sharpen` first. **Bug/hotfix?** Reproduce on the real artifact before patching (`Fix Root Causes`). **Feature:** `/pstack:how` (1 read-only explorer for real callers & data owner; `/pstack:why` if legacy code looks odd) + Layer 0 real payload/DOM capture (never invent simplified mocks) -> **5-bullet Design Lock** (proceed immediately under autonomous grants; pause only on irreversible/product forks). Build with `ponytail` discipline in verifiable commits. | `ponytail-review` lean trim -> **2-Model Fast Council** (2 distinct providers at High effort, e.g., Gemini 4 Neon High + GPT-6.2-Sol High, **max 2 rounds**; hold 3rd Opus seat only for disputed blockers) -> if risky BE/shared logic, `/pstack:blast-radius` (prove the one safety fact by running code). If UI changed: **Layer 1 (zero-cost DOM Oracle)** across desktop + mobile + interactive states -> **Layer 2 (~USD 0.20 Blind Visual & Heuristic Critic)** -> auto-fix Bucket A hygiene + list Bucket B recommendations. |
| **Tier 3: FULL RIGOR** (~USD 12-25+, 20-40 min, ask human first unless autonomous) | **ANY 1:** >=4 modules or >=15 files, complex state machine/multi-tab races, 3+ combined risk dimensions, security/auth/money/migration critical path, or **2+ failed fix attempts**. | Tier 2 + `/pstack:architect` (2 competing sketches, single state owner, clean boundaries) + `/pstack:statechart` (ONLY for async/protocol/state-machine logic). For multi-part unattended migrations, design the run with `/pstack:figure-it-out`. | Tier 2 + `/pstack:blast-radius` + full **3-Model Council** (Gemini 4 Neon High + GPT-6.2-Sol High + Claude Opus 5.5 High, **HARD CAP 3 rounds**; for BE/security/algorithms prefer runnable `/pstack:interrogate` proof over static prose). If UI changed: add **Layer 3 Chartered Exploratory UX Pass** (SBTM). |

**Auto-escalation tripwires:**
- Tier 1 touches a shared file (>=2 caller modules), API/schema boundary, or async timing -> escalate to Tier 2 immediately and state why in 1 line.
- **Circuit breaker (Attack the Premise):** 2 fix attempts fail the same check or introduce new bugs in the same area -> **STOP patching**, write down the hidden assumption, test it directly, and escalate to Tier 3 / human.

---

## Review Mode (`/adaptive-build review <PR / branch / path>`)

Skip Design Lock and feature planning. Run `adaptive_triage.py --kind review`, detect stack + tier, and execute the lowest-cost, highest-yield review lane (read-only unless asked to fix):

| Stack Detected | Highest-Frequency Failures | Optimal Review Lane | Skip (Token Guard) |
|---|---|---|---|
| **Pure Frontend / UI** | Async filter/loading races, dead whitespace, clipped text, mobile overflow, unspoken UX/hierarchy flaws | **Tier 1:** `ponytail-review` + Layer 1 (zero-cost DOM Oracle) + Layer 2 Blind Visual Critic. **Tier 2:** 2-Model Fast Council (1-2 rounds) + Layer 1 DOM Oracle + Layer 2 Blind Visual & Heuristic Critic. **Tier 3:** 3-Model Council (max 3 rounds) + Layer 3 Exploratory UX Pass. | Never burn static code-review rounds without rendering the UI and running Layer 1 + Layer 2. Skip 3rd Opus seat on Tier 1/2. |
| **Pure Backend / CLI / Lib** | Nil/null edge cases, races, broken callers, contract/schema drift, silent swallowed errors, security holes | **Tier 1:** `ponytail-review` + run real tests. **Tier 2:** `/pstack:blast-radius` (runnable proof) + 2-Model Fast Council (1-2 rounds). **Tier 3 / Security / DB:** runnable `/pstack:interrogate` (proof-only) + 1-round 2-Model Fast Council. | Skip static-only prose essays without executed repros. Skip UI scripts. |
| **Full-Stack (FE + BE)** | Wire-contract mismatch (`fieldA` vs `fieldB`), hand-typed mock drift, error swallowing, reload state loss | **Contract-First Gate:** (1) verify real BE JSON payload against FE types/fixtures; (2) 1-round 2-Model Fast Council; (3) Layer 1 DOM Oracle + Layer 2 Blind Visual & Heuristic Critic against the live running server (real API, not static HTML). | Never run Round 2 or 3 of static review before testing the real FE-to-BE wire flow end to end. |

---

## Tool Selection Map (When to Use Which Tool, Zero Stacking)

Use each tool for its **one sharpest job**. Never stack two tools that do the same thing.

| Tool / Skill | Exact Job | When to Use | When to Skip |
|---|---|---|---|
| `ponytail` (full) | Smallest complete diff, reuse existing code, zero speculative wrappers | **Every build tier (1, 2, 3)** during coding | Never skip during coding |
| `ponytail-review` | Fast plain-English bug/risk/scale/lean trim (~USD 0.50-1) | **Tier 1** primary review; **Tier 2/3** pre-council trim so multi-model reviewers don't waste tokens on bloat | Skip if trivial 1-line typo fix |
| `sol-loop` | Focused single-provider adversarial review loop (GPT Sol, max 2-3 rounds) | **Tier 1** alternative when code has subtle branching/logic | Skip if already running 2-Model or 3-Model Council |
| **2-Model Fast Council** (Gemini 4 Neon High + GPT-6.2-Sol High) | High-recall cross-provider review at ~50-60% cost of 3-Model Council | **Tier 2 default** (max 2 rounds) | Skip on Tier 1; upgrade to 3-Model on Tier 3 or disputed blockers |
| **3-Model `/council`** (Gemini + Sol + Claude Opus High) | Maximum cross-provider diversity for high-stakes changes | **Tier 3 only** (hard cap 3 rounds) or disputed Tier 2 blocker | Skip on Tier 1 and clean Tier 2 |
| `/pstack:how` / `/pstack:why` | 1 read-only codebase explorer for architecture/callers (`how`) or legacy rationale (`why`) | **Tier 2/3** before changing unfamiliar or shared code | Skip on Tier 1 isolated edits |
| `/pstack:architect` | 2 competing type/module sketches to lock single state ownership | **Tier 3** or contested **Tier 2** design | Skip for mechanical edits or settled designs |
| `/pstack:statechart` | Formal TLC model check of state transitions & races | Async/multi-tab/retry/protocol state machines | Skip on static UI or straight CRUD |
| `/pstack:blast-radius` | Prove the ONE safety fact by running real code | Risky shared helpers, BE/DB changes, hotfixes | Skip on isolated leaf UI |
| `/pstack:interrogate` | Multi-model adversarial review where only executed repros survive | High-risk BE, security, concurrency, data integrity | Skip on cosmetic FE changes |
| `/pstack:reframe` + `/pstack:sharpen` | Turn vague/fuzzy goals into expert framing and falsifiable criteria | Fuzzy problem statements before designing | Skip on clear, concrete tickets |
| `/pstack:figure-it-out` | Custom auditable multi-phase playbook for huge/unattended work | Multi-PR migrations or overnight autonomous runs | Skip on standard single-PR tasks |
| `/pstack:benchmark-checklist` | Vet perf/eval measurements (limiter, errors, repeatability) | Whenever reporting speedups, latency, or eval numbers | Skip when not benchmarking |
| `/pstack:correct` | Encode repeat bug classes (2nd occurrence) into types/lint/CI/scripts | Post-review / post-bug retrospective | Skip on one-off mistakes |
| `/pstack:arena` | Duplicate competing full-code implementations | **ONLY when explicitly requested** for zero-precedent bakeoffs | **Always skip by default** (use `/architect` sketches instead) |
| `ui-reviewer` / `design-taste-frontend` (optional) | Visual craft, typography, hierarchy, operational clarity | Any UI review skill you have for web apps/dashboards/tools; [`design-taste-frontend`](https://github.com/leonxlnx/taste-skill) for marketing/landing/brand sites. Layer 2 below covers the basics without them | Skip on non-UI tasks |

### If a skill is not installed

The bundled parts always work: `adaptive_triage.py`, Layer 1 (`browser_audit.mjs` + `ui_geometry_audit.js`) and the Layer 2/3 rubric in `references/`. Every other row names an outside skill. If it is missing, do its job by hand with the fallback, and say in the final report which fallbacks you used.

| Missing | Do this instead |
|---|---|
| `ponytail` | Write the smallest diff that solves the task. Reuse existing helpers. No new abstraction, option or dependency that the task does not need. |
| `ponytail-review` | Re-read the full diff and every caller of changed code. List only real bugs, risks and lines that can go. Fix them before any council. |
| `sol-loop` | Ask one fresh reviewer from another model family to review the diff. Fix the real findings, then ask again. Stop at 2 rounds or when only nits remain. |
| `council` (2-model or 3-model) | Run the same loop with 2 (or 3) reviewers from different providers in parallel. If your harness has only one provider, use one fresh-context reviewer and say that the council was not available. |
| `/pstack:how` | Before coding, list every caller of the code you change (`git grep`) and the single owner of the data. Read them. |
| `/pstack:why` | Read `git log -L` / `git blame` for the odd lines before you change them. |
| `/pstack:reframe` + `/pstack:sharpen` | Write the goal as 3 to 5 checkable pass/fail criteria before design. |
| `/pstack:architect` | Sketch 2 different designs in a few lines each. Pick the one with one state owner and fewer boundaries. Say why. |
| `/pstack:statechart` | Write the states and transitions as a table. Check each pair of events that can arrive in either order. |
| `/pstack:blast-radius` | Name the one fact that makes the change safe. Prove it by running code (a test or a script), not by reading. |
| `/pstack:interrogate` | Ask reviewers for executable repros only. Drop any finding that does not reproduce. |
| `/pstack:figure-it-out` | Write a phased plan with a check at the end of each phase before an unattended run. |
| `/pstack:benchmark-checklist` | For any speed or eval number: same machine, several runs, say what limits it, report errors. |
| `/pstack:correct` | When a bug class repeats, add a test, type, lint rule or CI check that fails on it. |
| `ui-reviewer` / `design-taste-frontend` | Use the Layer 2 rubric in `references/blind-visual-heuristic-critic.md`. |

---

## Autonomous Visual & Common-Sense UX Gate (Catching Unspoken Flaws)

Static code review alone misses rendered geometry failures and "common sense" UX problems. Whenever a build or review touches UI files, run this 3-layer visual pipeline **before** calling work done:

### Layer 1: `USD 0` Automated DOM Geometry & Runtime Oracle
Run the bundled headless browser audit against the running app across desktop (`1440x900`) and narrow/mobile (`390x844` or `768x1024`) plus key interactive states:

```bash
node <skill_dir>/scripts/browser_audit.mjs \
  --url http://127.0.0.1:<port> \
  --out <evidence_dir> \
  --viewports 1440x900,390x844 \
  [--actions <actions.json>]
```

Auto-fails on:
- Invisible in-flow layout reservations (`opacity: 0` / `visibility: hidden` >= 16px) or abnormal dead vertical gaps (> 48px)
- Clipped text (leaf overflow or `inline-flex`/`flex` nowrap pills overflowing without inner ellipsis)
- Horizontal page/container overflow or interactive controls pushed off-viewport
- Overlapping interactive controls (bounding-box collision)
- Console errors, uncaught page exceptions, failed HTTP requests (>= 400), broken images
- Accessibility & polish smells (unlabeled buttons/inputs, leaked raw ISO timestamps or internal `UPPER_SNAKE_CASE` enums in user-facing text)

### Layer 2: Context-Isolated Blind Visual & Heuristic Critic (~USD 0.20)
Spawn ONE fresh vision-capable reviewer with **zero code, zero diff, and zero commit context** using `references/blind-visual-heuristic-critic.md`. Give it ONLY:
1. The app's 1-sentence purpose
2. The captured state PNGs (desktop, mobile, empty, modal/hover, error)
3. The Layer 1 `audit-report.json`

It evaluates every screen against **Nielsen's 10 Usability Heuristics** and **UI Craft** (hierarchy, spacing, alignment, type) and splits findings into two strict buckets to avoid scope creep:

- **Bucket A: Auto-Fix Common-Sense UX Hygiene (fix immediately in Build/Polish mode):**
  - Layout clipping, dead gaps, overlap, mobile overflow, off-screen controls
  - Destructive actions (delete/overwrite) with no confirmation or undo
  - Missing loading/disabled state on async mutations (allowing double-submit)
  - Silent API errors (swallowed failures or missing inline error recovery)
  - Dead-end empty states (blank table/panel with no message or "Clear filters" action)
  - Leaked internal IDs, raw ISO timestamps, `undefined`/`NaN`, or raw enum keys
  - Broken basic affordances (modal cannot close via `Escape` or backdrop click, primary CTA visually indistinguishable from secondary muted controls)
- **Bucket B: Proactive Enhancement Recommendations (DO NOT silently build; present ranked table):**
  - Higher-level product improvements (new filters, bulk actions, keyboard shortcuts, onboarding tips, visual redesign options) ranked by **Impact** and **Effort** so the user can approve selectively ("do #1 and #3") without having to eyeball the app themselves.

### Layer 3: Chartered Exploratory UX Pass (Tier 3 or Multi-Screen Builds)
Run one time-boxed Session-Based Exploratory pass (`references/blind-visual-heuristic-critic.md` Part 2):
- **Look:** first impression, sibling consistency, clear primary action.
- **Touch:** rapid tab/filter switches (catch async races), empty search, long strings, narrow viewport, modal scroll/Escape, delete/undo, page reload persistence.
- **Follow:** save in one place, verify every consumer view updates; check browser network & console cleanly.

---

## Reporting Standard (Every Run)

End every Build or Review run with:
1. **Triage & Route:** Tier chosen, why, tools run, tools skipped.
2. **Defects Caught & Fixed (or Found in Review Mode):** grouped by **Logic/State/API**, **Visual/DOM Geometry**, and **Common-Sense UX Hygiene (Bucket A)**, each with concrete proof (test output, Layer 1 pass JSON, or screenshot path).
3. **Proactive UX Recommendations (Bucket B):** ranked 3-5 bullet table of non-bug enhancements the user did not ask for.
4. **Verification & Cost:** checks passed (`pass: true` on Layer 1 after fixes, tests green), wall-clock duration, and actual token/cost usage if exposed (never guessed without labeling).
