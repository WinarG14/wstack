# Layer 2 & Layer 3: Blind Visual & Heuristic Critic Rubric

## Part 1: Layer 2 Blind Visual & Heuristic Critic Prompt (Context-Isolated)

Spawn ONE fresh vision-capable reviewer with **zero code, zero git diff, and zero builder history**. Pass ONLY:
- 1-sentence description of what the app is for
- Paths to captured live PNGs (desktop, narrow/mobile, interactive states, empty state)
- Path to Layer 1 `audit-report.json`

Use this prompt:

```text
You are a senior product designer and QA lead inspecting a live web app cold.
You have ZERO code context on purpose. Inspect ONLY the attached screenshots and Layer 1 geometry JSON.

App purpose: <1-sentence goal>
Screenshots: <list of PNG paths>
Layer 1 JSON: <path to audit-report.json>

Evaluate every screen through:
1. Visual Craft & Geometry: dead whitespace, alignment, text clipping, overlap, responsive breakage, visual hierarchy (is the primary CTA clearly emphasized over secondary buttons? are KPI values prominent over labels?).
2. Nielsen's 10 Usability Heuristics (unspoken "common sense" flaws):
   - Visibility of system status (loading/feedback, active filters)
   - Match with real world (no leaked internal IDs, raw ISO timestamps, raw enum keys, or jargon)
   - User control & freedom (undo/confirm on destructive actions, Escape/backdrop closes modals)
   - Consistency & standards (uniform button hierarchy, spacing, alignment)
   - Error prevention & recovery (clear empty states with "Clear filters" action, clear error banners)
   - Aesthetic & minimalist design (scannable hierarchy, no clutter)

Output two strictly separated lists:
- BUCKET A (Auto-Fix Defects & UX Hygiene): concrete visual, functional, or common-sense UX defects that clearly hurt usability and should be fixed before shipping. Cite exact screenshot + region.
- BUCKET B (Proactive Enhancement Recommendations): 3 to 5 non-bug product/UX upgrades the user did not ask for, ranked by Impact (High/Med) and Effort (S/M/L). Do NOT mix optional wish-list items into Bucket A.

End with VERDICT: PASS or FAIL (FAIL if any Bucket A defect exists).
```

---

## Part 2: Layer 3 Chartered Exploratory UX Moves (Tier 3 / Multi-Screen Builds)

Use a single 15-20 minute Session-Based Test Management (SBTM) charter. Follow surprises instead of scripted checklists:

1. **Look (before clicking):**
   - What looks odd, out of proportion, cramped, or misaligned?
   - Can you tell in 5 seconds what the primary action and key metric are?
   - Are any raw system strings (IDs, enums, ISO UTC dates, `NaN`) visible?
2. **Touch (stress real interactions):**
   - **Fast hands:** rapidly click filter tabs / toggles in sequence. Does a slow earlier response overwrite the final tab?
   - **Double-click mutations:** click Approve / Save / Submit twice rapidly. Does it disable or fire duplicates?
   - **Destructive action:** click Delete. Does it ask for confirmation or offer Undo?
   - **Empty & long input:** search for nonsense (`zzzz`), test very long strings, open modals and press `Escape` or click backdrop.
   - **Narrow viewport:** resize to 390px or 768px. Does anything overflow horizontally or collide?
3. **Follow (verify truth across reload & views):**
   - Create or edit an item, reload the page, and verify totals, badges, and filters stay accurate.
   - Trigger an error response (if testable) and verify the user gets clear recovery guidance instead of a silent freeze.
