# Design notes: how `/adaptive-build` was framed

These notes came from a `/pstack:reframe` + `/pstack:sharpen` pass before the skill was built. They name the expert terms behind each design choice.

## Part 1: `/reframe` (Expert Vocabulary & Problem Disambiguation)

### What problems this description could name

Your request bundles three tightly connected problems. Naming them separately keeps the architecture clean:

1. **Cascaded Verification Routing (Risk-Stratified Orchestration):** Deciding before spending tokens which build and review tools (`ponytail`, selective `pstack` skills, `sol-loop`, 2-Model Fast Council, 3-Model Council) to run based on real change risk. *Sign:* you want a deterministic triage step and tier matrix that skips expensive multi-model loops on small isolated work.
2. **Autonomous Heuristic & Visual UI Inspection:** Giving an agent automated layout checks, blind visual critique, and UX taste so it catches layout defects and unspoken "common sense" flaws without you eyeballing screens one by one. *Sign:* you want the agent to inspect rendered states, auto-fix obvious UX hygiene breaks, and rank optional polish recommendations.
3. **Fault-Seeded Workflow Evaluation (Pareto Frontier Benchmarking):** Comparing No-Skill vs. Adaptive Skill vs. Full Council empirically on cost, duration, and defect recall across logic, visual, and UX defect classes. *Sign:* you want measured evidence, not intuition, showing where each workflow sits on the cost-quality-speed frontier.

The skill we are building solves **#1 + #2 together** (a **Risk-Stratified Build & Review Orchestrator with Autonomous Heuristic Inspection**), and we validate it using **#3**.

### Top 10 Expert Terms (Ranked by Design Impact)

| Rank | Term | Plain Meaning | Part of Your Request It Names | Confirmed Reference | What It Lets You Ask an Agent For |
|---|---|---|---|---|---|
| 1 | **LLM Cascade / Selective Routing** | Run cheap, fast lanes first and escalate to stronger or multi-model panels only when deterministic risk or uncertainty triggers require it. | Optimizing which tools/models to use by complexity to save tokens and time. | [FrugalGPT (arXiv:2305.05176)](https://arxiv.org/abs/2305.05176), [RouteLLM (arXiv:2406.18665)](https://arxiv.org/abs/2406.18665) | "Route Tier 1 to a single lean reviewer and escalate to a 2-model or 3-model cascade only on high-impact diffs." |
| 2 | **Change Impact Analysis (CIA)** | Static inspection of a diff and dependency/caller graph to compute blast radius (shared callers, API boundaries, async/state risk) before coding or reviewing. | Deciding complexity scenario automatically rather than guessing from prose. | [Change impact analysis (Wikipedia)](https://en.wikipedia.org/wiki/Change_impact_analysis) | "Run deterministic zero-token CIA on the repo diff and caller graph before choosing a review tier." |
| 3 | **Automated Layout Oracle (DOM Geometry Invariants)** | Deterministic browser checks that detect overflow, clipping, invisible height reservations, and overlapping controls across viewports without needing a pixel mockup. | Catching UI breakage automatically during build/review before pushing. | [ReDeCheck (GitHub)](https://github.com/redecheck/redecheck) | "Run a $0 DOM geometry oracle across desktop and mobile viewports before spending vision tokens." |
| 4 | **Heuristic Evaluation (Nielsen's 10 Heuristics)** | Structured UX inspection against 10 established usability rules (system feedback, real-world language, undo/confirm, error recovery, minimalist hierarchy). | Catching unspoken "common sense" UX problems the user did not explicitly list. | [10 Usability Heuristics for User Interface Design (NN/G)](https://www.nngroup.com/articles/ten-usability-heuristics/) | "Evaluate every changed screen against Nielsen's 10 Heuristics and split findings into auto-fix hygiene vs. optional enhancements." |
| 5 | **Blind Adjudication (Context-Isolated Critic)** | Reviewing rendered outputs in a fresh agent with zero builder/code context to eliminate confirmation bias and self-enhancement bias. | Eyeballing the rendered UI like a fresh picky user rather than justifying the builder's own code. | [Judging LLM-as-a-Judge (arXiv:2306.05685)](https://arxiv.org/abs/2306.05685) | "Spawn a blind visual critic with only the live screenshots and geometry JSON, zero code or commit history." |
| 6 | **Session-Based Exploratory Testing (SBTM)** | Time-boxed, charter-driven exploration ("look, touch, follow surprises") that uncovers unknown-unknowns scripted tests miss. | Having the skill explore the app and spot things that "don't make sense" without scripted test cases. | [Session-based testing (Wikipedia)](https://en.wikipedia.org/wiki/Session-based_testing) | "Run a 1-charter exploratory session across empty, error, rapid-click, and reload states on Tier 3 UI." |
| 7 | **Fault Seeding / Mutation Testing** | Planting a known ground-truth catalog of logic, visual, and UX defects into a test app so benchmark arms can be scored objectively on recall and false positives. | Simulating and comparing No-Skill vs. Adaptive Skill vs. Council on how many bugs and UI issues each catches. | [Stryker Mutator](https://stryker-mutator.io/) | "Seed 12 ground-truth defects across logic, layout geometry, and unspoken UX, then score recall per arm." |
| 8 | **Test Pyramid / Verification Stratification** | Layering fast, cheap deterministic checks at the base (unit tests, lint, DOM geometry) and reserving slow, costly browser/ensemble checks for the top. | Avoiding token waste and slow runs while still catching high-severity bugs. | [The Practical Test Pyramid (Martin Fowler)](https://martinfowler.com/articles/practical-test-pyramid.html) | "Enforce a verification pyramid: $0 static/DOM checks first, ~$0.20 blind vision second, multi-model council only when triggered." |
| 9 | **Visual Regression / Multi-State Capture** | Capturing real rendered screenshots across key states and breakpoints (rest, hover, modal, empty, narrow viewport) as concrete evidence. | Performing real visual checks instead of guessing CSS behavior from code. | [Visual comparisons (Playwright)](https://playwright.dev/docs/test-snapshots) | "Capture desktop and mobile screenshots across initial, filtered, modal, and empty states before declaring done." |
| 10 | **Cross-Model Ensemble Diversity** | Pairing models from distinct providers (e.g., Gemini + GPT Sol, adding Claude Opus only on Tier 3) to reduce correlated blind spots while capping review rounds. | Deciding when to use 2-Model Fast Council vs. full 3-Model Council vs. single-model review. | [Judging LLM-as-a-Judge (arXiv:2306.05685)](https://arxiv.org/abs/2306.05685) | "Use a 2-provider Fast Council on Tier 2 with a 2-round cap; reserve the 3rd provider seat for Tier 3 or disputed blockers." |

### Neighboring Fields That Solved the Same Shape

1. **Emergency Medicine Triage (ESI 5-Level Triage & Diagnostic Escalation):**
   - *Carries over:* Fast, zero-cost vitals check (`adaptive_triage.py`) sorts cases into acuity tiers before ordering expensive scans (CT/MRI = 3-Model Council). Explicit red-flag auto-escalation tripwires override initial low-acuity routing.
   - *Where it breaks:* Software changes are cheap to re-run and diff deterministically; unlike patients, we can inspect the exact dependency graph before touching anything.
   - *Terms that come back:* Acuity stratification, red-flag escalation tripwires, diagnostic yield per dollar.
2. **Semiconductor Manufacturing & PCB Inspection (AOI + Human-Level Sampling):**
   - *Carries over:* Automated Optical Inspection (Layer 1 `$0` DOM Geometry Oracle) screens 100% of boards cheaply for alignment/overlap/clipping before routing suspects to deeper inspection (Layer 2 Blind Vision Critic) and destructive stress tests (`/pstack:interrogate`).
   - *Where it breaks:* Visual craft and usability taste are partly subjective, so software needs a clean split between objective defects (auto-fix) and subjective taste calls (ranked recommendations).
   - *Terms that come back:* Automated optical inspection, defect escape rate, false-call rate.
3. **Aviation Preflight & Sterile Cockpit Checklists:**
   - *Carries over:* Short, role-separated checklists prevent skipping boring checks (reload persistence, narrow viewport, error states) and stop tool-stacking bloat.
   - *Where it breaks:* Creative UX enhancement requires exploratory judgment, not only fixed checklists.
   - *Terms that come back:* Verification gate, hard stop, separation of duties (builder vs. blind verifier).

### What You Did Not Mention, But Should Care About

1. **Scope-Creep Guardrail on Proactive Fixes:** If an agent "fixes common sense things not explicitly stated" with no boundary, it will silently rewrite features you wanted kept stable. Separating **Bucket A (Auto-Fix UX Hygiene Defects)** from **Bucket B (Ranked Optional Product Enhancements)** gives you proactive polish without surprise scope drift.
2. **Correlated Static Blind Spots:** Even a 3-model static Council reads *code*, not *pixels*. Without a real rendered DOM oracle + blind screenshot critic, all 3 flagship models frequently miss runtime layout collapse, invisible `opacity: 0` gaps, overlapping controls at 390px, and real async timing races.
3. **False-Positive / Churn Cost:** A review workflow that catches 10 bugs while inventing 12 nitpicks wastes rounds and introduces regressions. Tracking both **defect recall** and **unnecessary churn** keeps the skill honest.

### Rewritten Prompt (Reframed & Sharpened)

> Design and install a project-agnostic **Risk-Stratified Build & Review Orchestrator** skill (`/adaptive-build`) for any software repository. Start from raw existing skills (an earlier project-specific build skill, `ponytail`, `pstack` 0.15.48, `council`, `sol-loop`, `ui-reviewer`, `design-taste-frontend`). Bundle two deterministic zero-token tools inside the skill: (1) a repo-agnostic **Change Impact Analysis (CIA)** router (`adaptive_triage.py`) that assigns Tier 1 (Lean), Tier 2 (Targeted Rigor), or Tier 3 (Full Rigor) with zero tool stacking and hard round caps, and (2) a headless browser **Automated Layout Oracle** (`ui_geometry_audit.js` + `browser_audit.mjs`) paired with a **Context-Isolated Blind Visual & Heuristic Critic** rubric based on Nielsen's 10 Heuristics that separates auto-fixable UX hygiene defects from ranked product-enhancement proposals. Validate the skill empirically against a **fault-seeded runnable web app** containing 12 ground-truth defects (4 logic/state/API, 4 DOM/layout geometry, 4 unspoken common-sense UX/craft flaws) across three real arms: **Arm A (No-Skill Baseline)**, **Arm B (`/adaptive-build` Tier 2 + Visual/Heuristic Gate)**, and **Arm C (Full 3-Model Static `/council`)**, measuring wall-clock duration, token/cost proxies, defect recall by category, and proactive UX signal.

---

## Part 2: `$sharpen` Check (4 Professional Questions)

1. **What a top professional does here that was not asked:** Builds a *deterministic* `$0` triage classifier and a *deterministic* `$0` DOM geometry oracle first so LLM tokens are spent only on reasoning and judgment, not guessing risk or measuring pixels by eye; and evaluates arms against a fixed, pre-declared fault-seeded rubric (mutation/defect injection) instead of hand-wavy simulated numbers.
2. **Rawest material started from:** Installed `pstack` `0.15.48` skills (`reframe`, `sharpen`, `poteto-mode`, `how`, `architect`, `statechart`, `blast-radius`, `interrogate`, `figure-it-out`, `correct`, `benchmark-checklist`), an earlier project-specific build skill with its own triage script and UI geometry audit, `ponytail`, `ponytail-review`, `sol-loop`, `council`, `ui-reviewer`, and `design-taste-frontend`.
3. **Specific methods and tools used:** Deterministic git-diff + `git grep` CIA (`adaptive_triage.py`), Playwright + Chrome headless multi-viewport DOM geometry oracle (`browser_audit.mjs` + `ui_geometry_audit.js`), cross-provider T3 `delegate_task` arms (`claude-opus-5-5`, `gpt-6.2-sol`, `gemini-4-neon`), blind zero-code visual critique on captured PNGs, and automated + manual ground-truth scoring against 12 seeded defects.
4. **What outside us shows the result is right:** (a) `adaptive_triage.py` passes deterministic unit checks across Tier 1, Tier 2, and Tier 3 fixtures; (b) `browser_audit.mjs` deterministically detects the 4 planted layout/geometry bugs before fix and outputs `pass: true` after fix; (c) the 3 live benchmark arms produce verifiable git diffs, captured screenshots, recorded wall-clock timings, and objective recall counts against the 12 seeded defects.
