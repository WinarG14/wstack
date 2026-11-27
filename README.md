# wstack

Agent skills I use every day, cleaned up so anyone can use them. They work in Claude Code and Codex.
(Yes, the name is a nod to [tstack](https://github.com/t3dotgg/tstack).)

## Skills

| Skill | Say | What it does |
|---|---|---|
| [`adaptive-build`](skills/adaptive-build/SKILL.md) | "/adaptive-build &lt;task&gt;" or "/adaptive-build review &lt;PR&gt;" (plugin: `/wstack:adaptive-build`) | Picks the right amount of rigor for each change, then runs **one tool per job** from tstack, pstack and ponytail. Adds a USD 0 layout check and a blind visual critic, so UI bugs get caught before you look. |

## `adaptive-build`: one conductor for tstack, pstack and ponytail

Good skill packs exist. The hard part is knowing **which one to run, and when to stop**. If you run `/council` on a one-line fix, you waste USD 5. If you skip review on an auth change, you ship a bug. If you stack `sol-loop` on top of `council` on top of `interrogate`, three tools do the same job.

`adaptive-build` makes that choice for you:

1. **Triage first, for free.** `scripts/adaptive_triage.py` reads the real git diff in under 2 seconds and with zero tokens: file count, module spread, caller fan-out (`git grep`), API/DB/auth/config boundaries, async and concurrency primitives, UI files. It puts the change in a tier and prints what it will run and what it will skip.
2. **Three tiers, one role per tool, hard round caps.**

   | Tier | When | Build | Review |
   |---|---|---|---|
   | 1 LEAN (~USD 0.5-3) | 1-4 files, one module, no boundary | `ponytail` smallest diff | `ponytail-review` **or** one `sol-loop` (max 2 rounds) |
   | 2 TARGETED (~USD 4-10) | shared code, API/DB/auth, bug fix, async, 5-14 files | `/pstack:how` for real callers → 5-bullet design lock → `ponytail` | `ponytail-review` trim → 2-model fast council (2 providers, max 2 rounds) → `/pstack:blast-radius` when risky |
   | 3 FULL (~USD 12-25) | 15+ files, state machines, security/money/migration, or 2 failed fixes | + `/pstack:architect`, `/pstack:statechart` | + full 3-model `/council` (cap 3 rounds) or `/pstack:interrogate` |

   It escalates by itself when a Tier 1 change touches shared code or a contract. After two failed fixes in the same place it stops patching and tests the hidden assumption.
3. **It looks at the screen.** Static review reads code, not pixels. When UI files change it runs:
   - **Layer 1, USD 0:** `scripts/browser_audit.mjs` + `scripts/ui_geometry_audit.js` in headless Playwright at desktop and mobile widths. They fail on clipped text, dead gaps, horizontal overflow, controls off screen, overlapping buttons, console errors, failed requests, broken images, unlabeled controls, and raw IDs, ISO dates or `ENUM_KEYS` in the UI.
   - **Layer 2, about USD 0.04-0.20:** a fresh vision model sees only screenshots and the Layer 1 JSON, no code. It checks Nielsen's 10 heuristics and splits findings into **Bucket A** (fix now: no delete confirm, double submit, swallowed errors, dead-end empty states) and **Bucket B** (ranked ideas you approve one by one, so no scope creep).
   - **Layer 3 (Tier 3):** a short exploratory pass: fast tab switching, double clicks, long strings, reload, `Escape`.

### Research result

We ran one fault-seeded benchmark: a small expense app with 12 planted defects (4 logic/API, 4 layout, 4 unstated UX). Full write-up, per-seat token table and limits: [`research/adaptive-build-benchmark/`](research/adaptive-build-benchmark/README.md).

![Benchmark summary: /adaptive-build fixed 12 of 12 planted bugs at USD 1.53; no skill and the 3-model council each fixed 10](research/adaptive-build-benchmark/benchmark-summary.png)

| | No skill | `/adaptive-build` (Tier 2) | Full 3-model `/council` |
|---|---|---|---|
| Defects fixed | 10 / 12 | **12 / 12** | 10 / 12 |
| Cost (measured tokens × list rates) | USD 1.51 | USD 1.53 | USD 6.19, not finished |
| Diff size | 1,252 lines | **749 lines** | 764 lines |
| New regressions | 0 | 0 | 1 blocker |

The short version: the same cost as no skill, all 12 fixed, and about 4x cheaper than the council. Six flagship static reviews missed 7 buttons off screen on mobile and raw DB IDs in the UI. The USD 0 DOM check found both in 4 seconds.

Caveats: one run per arm on one synthetic app. 5 of the 12 checks use the skill's own geometry script. The `/adaptive-build` cost leaves out its parent session, and that run skipped `ponytail-review` and `/pstack:how`. Read the [limits](research/adaptive-build-benchmark/README.md#limits-read-before-you-quote-the-numbers) before you quote it.

## Install

**Claude Code plugin (recommended, gets updates):**

```
/plugin install wstack --marketplace WinarG14/wstack
```

Older Claude Code (before 2.1.275): `/plugin marketplace add WinarG14/wstack`, then `/plugin install wstack@wstack`. As a plugin, the skill is `/wstack:adaptive-build`.

**Turn on auto-update once:** run `/plugin`, open **Marketplaces**, select `wstack`, and turn on auto-update. Claude Code keeps it off for marketplaces outside Anthropic's, and a marketplace cannot turn it on for you. The plugin has no fixed version, so every push to `main` reaches you.

**Codex plugin:** this repo also ships `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.

**Or copy the files:**

```bash
git clone https://github.com/WinarG14/wstack
cp -R wstack/skills/* ~/.claude/skills/   # Claude Code
cp -R wstack/skills/* ~/.codex/skills/    # Codex
```

**UI layers only:** `npm i -g playwright && npx playwright install chromium` (or install Playwright in your project).

`load_playwright.mjs` finds Playwright in the current project, `NODE_PATH`, or the global npm root. It uses Playwright's Chromium, or your installed Chrome if Chromium is not downloaded.

## Requirements

**Works on its own:** the triage script, Layer 1 (layout check) and the Layer 2/3 critic rubric. These need only `python3`, `git`, `node` and Playwright.

**Calls other skills by name.** `adaptive-build` conducts them. It does not copy them. Install the ones you want:

- [ponytail](https://github.com/DietrichGebert/ponytail): `ponytail`, `ponytail-review`
- [tstack](https://github.com/t3dotgg/tstack): `council`, `sol-loop`
- [pstack](https://github.com/cursor/plugins/tree/main/pstack): `how`, `why`, `architect`, `statechart`, `blast-radius`, `interrogate`, `reframe`, `sharpen`, `figure-it-out`, `correct`, `benchmark-checklist`
- Optional, for visual craft: [taste-skill](https://github.com/leonxlnx/taste-skill) (`design-taste-frontend`) or any UI review skill
- For the councils: a harness that can run models from other providers. [T3 Code](https://github.com/pingdotgg/t3code) does this with `delegate_task`.

If one is missing, the skill still runs. The triage output adds a `Not installed:` line under `RUN:`, and `SKILL.md` has a fallback row for each skill (for example: no `sol-loop` means one fresh reviewer from another model family, 2 rounds at most). The agent must say in its report which fallbacks it used. The full tier flow works best with all three packs installed.

## Make it yours

The model names in the councils (Gemini 4 Neon, GPT-6.2-Sol, Claude Opus 5.5) and the USD ranges are mine. Change them to the models you have. The risk patterns sit at the top of `adaptive_triage.py`, and the tier thresholds are in its `recommend()` function (search for `tier3_reasons`).

## License

[MIT](LICENSE)
