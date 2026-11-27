#!/usr/bin/env python3
"""Project-agnostic deterministic Change Impact Analysis (CIA) and 3-Tier triage router.

Zero-token classifier for ANY git repository (FE, BE, Full-Stack, CLI, scripts).
Computes risk from real diff size, module/directory spread, git-grep caller fan-out,
boundary/contract patterns (API, DB, migrations, auth, config), async/concurrency
primitives, UI files, and pre-coding prompt signals.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

UI_EXTS = {".tsx", ".jsx", ".vue", ".svelte", ".html", ".css", ".scss", ".less"}
CODE_EXTS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".py", ".go", ".rs",
    ".java", ".kt", ".rb", ".php", ".cs", ".swift", ".c", ".cpp", ".h", ".sql",
}
SHARED_DIR_MARKERS = (
    "/shared/", "/common/", "/lib/", "/core/", "/utils/", "/helpers/",
    "/hooks/", "/stores/", "/components/ui/", "/api/", "/client/", "/pkg/",
    "/internal/", "/middleware/", "/models/", "/schemas/",
)
BOUNDARY_PATH_RE = re.compile(
    r"(migration|schema|prisma|openapi|swagger|proto|graphql|auth|rbac|permission|"
    r"billing|payment|checkout|routes?|controllers?|handlers?|api/|endpoints?|"
    r"config|settings|\.env|dockerfile|terraform|helm|k8s)",
    re.I,
)
BE_PATH_MARKERS = (
    "/server", "/backend", "/api/", "/routes/", "/controllers/", "/handlers/",
    "/services/", "/db/", "/prisma/", "server.js", "server.ts", "server.mjs",
    "server.cjs", "server.mts", "app.py",
)
ASYNC_CONCURRENCY_RE = re.compile(
    r"\b(setInterval|setTimeout|visibilitychange|document\.hidden|EventSource|"
    r"WebSocket|AbortController|Promise\.(?:all|race|allSettled)|mutex|Mutex|"
    r"sync\.WaitGroup|asyncio\.(?:gather|create_task|Lock)|threading\.Lock|"
    r"BroadcastChannel|transaction|BEGIN\s+TRANSACTION|FOR\s+UPDATE|optimistic|"
    r"debounce|throttle)\b"
)
UI_SUMMARY_RE = re.compile(
    r"\b(ui|ux|page|screen|button|form|table|panel|sidebar|header|footer|modal|"
    r"dialog|layout|responsive|mobile|dashboard|css|style|theme|visual|tooltip|"
    r"badge|filter|dropdown|frontend|front-end)\b",
    re.I,
)
BE_SUMMARY_RE = re.compile(
    r"\b(backend|back-end|server|api|endpoint|database|db|sql|migration|"
    r"webhook|worker|queue|cron|service|rpc|graphql|rest)\b",
    re.I,
)
# (dim_key, pattern, label)
TIER2_SUMMARY_SIGNALS: List[Tuple[str, str, str]] = [
    ("hotfix", r"\b(hotfix|live issue|live bug|production|prod bug|incident|outage)\b", "Production bug / hotfix"),
    ("boundary", r"\b(api|endpoint|contract|schema|migration|database|db|sql|payload|mock|404)\b", "API / data contract boundary"),
    ("auth_money", r"\b(auth|login|oauth|token|permission|rbac|security|billing|payment|money|settlement|ledger|refund|payout)\b", "Auth / security / billing boundary"),
    ("shared", r"\b(shared|common|core|refactor callers|across pages|multiple screens)\b", "Shared component or multi-caller scope"),
    ("async", r"\b(race|async|polling|timer|websocket|stream|reload|optimistic|concurrent)\b", "Async / timing / state coordination"),
    ("ui_complex", r"\b(redesign|multi-?screen|multi-?page|multi-?state|dashboard)\b", "Multi-screen or complex UI surface"),
]
TIER3_SUMMARY_SIGNALS: List[Tuple[str, str]] = [
    (r"\b(multi-?pr|rewrite|overhaul|architecture|migration|stacked|orchestrat)\b", "Multi-PR or architectural rewrite"),
    (r"\b(state machine|race condition|distributed|multi-?tab|concurrency|deadlock)\b", "Complex state machine or concurrency"),
    (
        r"\b(security audit|cryptography|data migration|zero-?downtime|"
        r"money\s+(?:transfer|settlement|calculation|ledger|payout)|"
        r"settlement|ledger|payout|billing\s+(?:logic|engine|calculation)|"
        r"auth\s+(?:flow|middleware|policy|token\s+validation))\b",
        "High-stakes security, money, or data migration path",
    ),
]


def run_git(repo: Path, args: List[str]) -> Tuple[int, str]:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return proc.returncode, proc.stdout.rstrip("\r\n")
    except Exception as exc:
        return 2, str(exc)


EXPECTED_SKILLS = ("ponytail", "ponytail-review", "sol-loop", "council")
PSTACK_PROBES = ("how", "blast-radius")


def skill_search_roots() -> Tuple[List[Path], List[Path]]:
    home = Path.home()
    skill_roots: List[Path] = []
    plugin_roots: List[Path] = []
    gemini_home = os.environ.get("GEMINI_HOME", "").strip()
    if gemini_home:
        gh = Path(gemini_home).expanduser()
        skill_roots.append(gh / "config/skills")
        plugin_roots.append(gh / "config/plugins")
    skill_roots.extend([
        home / ".gemini/config/skills",
        home / ".claude/skills",
        home / ".codex/skills",
        home / ".agents/skills",
    ])
    plugin_roots.extend([
        home / ".gemini/config/plugins",
        home / ".claude/plugins",
    ])
    # Preserve order while deduplicating resolved/raw paths.
    seen_s: Set[str] = set()
    uniq_s: List[Path] = []
    for p in skill_roots:
        key = str(p)
        if key not in seen_s:
            seen_s.add(key)
            uniq_s.append(p)
    seen_p: Set[str] = set()
    uniq_p: List[Path] = []
    for p in plugin_roots:
        key = str(p)
        if key not in seen_p:
            seen_p.add(key)
            uniq_p.append(p)
    return uniq_s, uniq_p


def _has_disable_model_invocation(skill_md: Path) -> bool:
    try:
        head = skill_md.read_text(errors="ignore")[:800]
    except OSError:
        return False
    return bool(re.search(r"^\s*disable-model-invocation:\s*true\s*$", head, re.M | re.I))


def inspect_skills() -> Tuple[List[str], List[str]]:
    """Best-effort, zero-token check for companion SKILL.md files across Claude, Codex, and Antigravity."""
    skill_roots, plugin_roots = skill_search_roots()
    missing: List[str] = []
    notes: List[str] = []

    for s in EXPECTED_SKILLS:
        if not any((root / s / "SKILL.md").is_file() for root in skill_roots):
            missing.append(s)

    pstack_claude_files: List[Path] = []
    missing_pstack_probes: List[str] = []
    for probe in PSTACK_PROBES:
        found = [root / probe / "SKILL.md" for root in skill_roots if (root / probe / "SKILL.md").is_file()]
        for proot in plugin_roots:
            if not proot.is_dir():
                continue
            for pat in (
                f"pstack/skills/{probe}/SKILL.md",
                f"*/pstack/skills/{probe}/SKILL.md",
                f"*/*/pstack/skills/{probe}/SKILL.md",
                f"*/*/pstack/*/skills/{probe}/SKILL.md",
            ):
                found.extend(p for p in proot.glob(pat) if p.is_file())
        if not found:
            missing_pstack_probes.append(probe)
        else:
            pstack_claude_files.extend(p for p in found if ".claude/plugins" in str(p))

    if len(missing_pstack_probes) == len(PSTACK_PROBES):
        missing.append("pstack")
    else:
        for probe in missing_pstack_probes:
            missing.append(f"pstack:{probe}")

    if any(_has_disable_model_invocation(p) for p in pstack_claude_files):
        notes.append(
            "pstack (Claude plugin sets disable-model-invocation: true -> Read <pstack>/skills/<name>/SKILL.md directly instead of calling the Skill tool)"
        )

    return missing, notes


def is_test_or_doc(path: str) -> bool:
    low = path.lower().replace("\\", "/")
    name = Path(low).name
    return (
        ".test." in name
        or ".spec." in name
        or "_test." in name
        or name.startswith("test_")
        or "/__tests__/" in f"/{low}"
        or "/tests/" in f"/{low}"
        or low.startswith(("tests/", "test/", "e2e/", "docs/"))
        or low.endswith((".md", ".txt", ".lock", ".png", ".jpg", ".svg"))
    )


def module_bucket(rel_path: str) -> str:
    parts = [p for p in rel_path.replace("\\", "/").split("/") if p]
    if not parts:
        return "root"
    if parts[0] in ("src", "app", "packages", "apps", "services", "internal", "pkg") and len(parts) >= 3:
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "root"


def is_shared_file(path: str) -> bool:
    norm = "/" + path.replace("\\", "/").lstrip("/")
    return any(m in norm for m in SHARED_DIR_MARKERS) and not is_test_or_doc(path)


def detect_default_base(repo: Path, explicit_base: str) -> str:
    if explicit_base:
        if run_git(repo, ["rev-parse", "--verify", "-q", f"{explicit_base}^{{commit}}"])[0] == 0:
            return explicit_base
    for cand in ("origin/main", "origin/master", "main", "master"):
        if run_git(repo, ["rev-parse", "--verify", "-q", f"{cand}^{{commit}}"])[0] == 0:
            return cand
    return ""


def resolve_git_scope(repo: Path) -> Tuple[Path, str]:
    """Return (git_root, subdir_prefix) so subdirectory --repo scopes cleanly without mixing path bases."""
    rc, top = run_git(repo, ["rev-parse", "--show-toplevel"])
    if rc != 0 or not top.strip():
        return repo, ""
    git_root = Path(top.strip()).resolve()
    try:
        rel = repo.resolve().relative_to(git_root)
        prefix = "" if str(rel) == "." else rel.as_posix().rstrip("/") + "/"
    except ValueError:
        prefix = ""
    return git_root, prefix


def _normalize_git_path(path: str) -> str:
    norm = path.replace("\\", "/")
    while norm.startswith("./"):
        norm = norm[2:]
    return norm


def _in_subdir(path: str, prefix: str) -> str | None:
    """Preserve git-root-relative path (including leading dotfiles and parent dir markers) while filtering to prefix."""
    norm = _normalize_git_path(path)
    if not prefix:
        return norm
    if norm.startswith(prefix):
        return norm
    return None


def get_changed_files(
    repo: Path,
    git_root: Path,
    subdir_prefix: str,
    base_ref: str,
    review_whole_repo: bool = False,
) -> Tuple[List[str], str, bool]:
    merge_base = ""
    if base_ref:
        rc, out = run_git(git_root, ["merge-base", "HEAD", base_ref])
        if rc == 0 and out.strip():
            merge_base = out.strip()
    files: Set[str] = set()
    if merge_base:
        diff_args = ["diff", "--name-only", "-z", f"{merge_base}...HEAD"]
        if subdir_prefix:
            diff_args.extend(["--", subdir_prefix.rstrip("/")])
        rc, diff_out = run_git(git_root, diff_args)
        if rc == 0 and diff_out:
            for p in diff_out.split("\0"):
                if not p:
                    continue
                kept = _in_subdir(p, subdir_prefix)
                if kept:
                    files.add(kept)
    status_args = ["status", "--porcelain", "-z", "--untracked-files=all"]
    if subdir_prefix:
        status_args.extend(["--", subdir_prefix.rstrip("/")])
    rc_st, st_out = run_git(git_root, status_args)
    if rc_st == 0 and st_out:
        entries = st_out.split("\0")
        i = 0
        while i < len(entries):
            entry = entries[i]
            i += 1
            if len(entry) < 4:
                continue
            kept = _in_subdir(entry[3:], subdir_prefix)
            if kept:
                files.add(kept)
            if entry[0] in "RC":  # rename/copy: next entry is the old path
                i += 1

    scope_incomplete = False
    # Review mode on a clean tree with no branch diff: inspect a small repo's tracked files
    if not files and review_whole_repo and repo.is_dir():
        ls_args = ["ls-files", "-z"]
        if subdir_prefix:
            ls_args.extend(["--", subdir_prefix.rstrip("/")])
        rc_ls, ls_out = run_git(git_root, ls_args)
        if rc_ls == 0 and ls_out:
            tracked = [_normalize_git_path(p) for p in ls_out.split("\0") if p]
            if len(tracked) <= 40:
                files.update(tracked)
            else:
                scope_incomplete = True
    return sorted(files), merge_base, scope_incomplete


def scan_caller_fanout(repo: Path, candidate_files: List[str], subdir_prefix: str = "") -> Dict[str, List[str]]:
    def scoped_bucket(path: str) -> str:
        rel = path[len(subdir_prefix):] if (subdir_prefix and path.startswith(subdir_prefix)) else path
        return module_bucket(rel)

    fanout: Dict[str, List[str]] = {}
    for f in candidate_files[:20]:
        p = Path(f)
        if p.suffix.lower() not in CODE_EXTS:
            continue
        stem = p.stem if p.stem not in ("index", "__init__", "main", "mod", "app", "server") else p.parent.name
        if not stem or len(stem) < 4:
            continue
        rc, out = run_git(repo, ["grep", "-z", "-l", "-F", stem])
        if rc != 0 or not out:
            continue
        own_mod = scoped_bucket(f)
        caller_mods: Set[str] = set()
        for hit in out.split("\0"):
            if not hit or hit == f or is_test_or_doc(hit) or Path(hit).suffix.lower() not in (CODE_EXTS | UI_EXTS):
                continue
            if scoped_bucket(hit) != own_mod:
                caller_mods.add(scoped_bucket(hit))
        if len(caller_mods) >= 2:
            fanout[f] = sorted(caller_mods)
    return fanout


def detect_async_and_stack(
    repo: Path | None,
    git_root: Path | None,
    files: List[str],
    summary_low: str,
) -> Tuple[bool, str, List[str], bool]:
    has_ui = False
    has_be = False
    has_async = False
    boundary_hits: List[str] = []

    for f in files:
        norm = f.replace("\\", "/")
        ext = Path(norm).suffix.lower()
        if ext in UI_EXTS or "/public/" in f"/{norm}" or "/frontend/" in f"/{norm}" or "/components/" in f"/{norm}":
            has_ui = True
        if ext in {".py", ".go", ".rs", ".java", ".rb", ".sql"} or any(
            k in f"/{norm.lower()}" for k in BE_PATH_MARKERS
        ):
            has_be = True
        if BOUNDARY_PATH_RE.search(norm):
            boundary_hits.append(norm)
        if ext in (CODE_EXTS | UI_EXTS):
            fp = None
            if repo and (repo / norm).is_file():
                fp = repo / norm
            elif git_root and (git_root / norm).is_file():
                fp = git_root / norm
            if fp is not None:
                try:
                    txt = fp.read_text(errors="ignore")
                    if ASYNC_CONCURRENCY_RE.search(txt):
                        has_async = True
                except OSError:
                    pass

    summary_ui = bool(UI_SUMMARY_RE.search(summary_low))
    summary_be = bool(BE_SUMMARY_RE.search(summary_low))
    if not files:
        has_ui = summary_ui
        has_be = summary_be
    elif summary_ui:
        has_ui = True

    if has_ui and has_be:
        stack = "Full-Stack (FE + BE)"
    elif has_ui:
        stack = "Frontend / UI"
    elif has_be:
        stack = "Backend / Service / CLI"
    else:
        stack = "General Code / Scripts"
    return has_async, stack, boundary_hits, has_ui


def recommend(args: argparse.Namespace) -> Dict:
    repo = Path(args.repo).expanduser().resolve() if args.repo else None
    git_root = repo
    subdir_prefix = ""
    if repo and repo.is_dir():
        git_root, subdir_prefix = resolve_git_scope(repo)

    files: List[str] = []
    for item in args.files:
        for part in item.split(","):
            if part.strip():
                files.append(part.strip())

    base_ref = ""
    scope_incomplete = False
    if repo and repo.is_dir() and not args.no_git_diff:
        base_ref = detect_default_base(repo, args.base or "")
        git_files, _, scope_incomplete = get_changed_files(
            repo, git_root or repo, subdir_prefix, base_ref, review_whole_repo=(args.kind == "review")
        )
        files = sorted(set(files) | set(git_files))

    non_test_files = [f for f in files if not is_test_or_doc(f)]
    scoped_for_modules = [
        f[len(subdir_prefix):] if (subdir_prefix and f.startswith(subdir_prefix)) else f
        for f in non_test_files
    ]
    modules = sorted({module_bucket(f) for f in scoped_for_modules})
    shared_files = [f for f in non_test_files if is_shared_file(f)]
    caller_fanout = scan_caller_fanout(git_root or repo, shared_files or non_test_files, subdir_prefix) if (repo and non_test_files) else {}
    summary_low = (args.summary or "").lower()
    has_async, stack, boundary_hits, has_ui = detect_async_and_stack(repo, git_root, non_test_files, summary_low)

    t2_summary = [(dim, label) for dim, pat, label in TIER2_SUMMARY_SIGNALS if re.search(pat, summary_low)]
    t3_summary = [label for pat, label in TIER3_SUMMARY_SIGNALS if re.search(pat, summary_low)]

    tier2_reasons: List[str] = []
    tier3_reasons: List[str] = []
    risk_dim_keys: Set[str] = set()

    if args.failed_attempts >= 2:
        tier3_reasons.append(f"Circuit breaker: {args.failed_attempts} failed attempts (Attack the Premise)")

    if args.kind == "hotfix":
        tier2_reasons.append("Production hotfix (needs root-cause repro + blast-radius proof)")
        risk_dim_keys.add("hotfix")
    elif args.kind == "bug":
        tier2_reasons.append("Bug fix (reproduce on the real artifact before patching)")

    if caller_fanout:
        top = ", ".join(f"{k} ({len(v)} modules)" for k, v in list(caller_fanout.items())[:3])
        tier2_reasons.append(f"High caller fan-out: {top}")
        risk_dim_keys.add("shared")
    elif shared_files:
        tier2_reasons.append(f"Touches shared modules: {', '.join(shared_files[:4])}")
        risk_dim_keys.add("shared")

    if boundary_hits:
        tier2_reasons.append(f"Contract/boundary files: {', '.join(boundary_hits[:4])}")
        risk_dim_keys.add("boundary")

    if has_async:
        tier2_reasons.append("Async / network / concurrency primitives detected (race & reload risk)")
        risk_dim_keys.add("async")

    if stack == "Full-Stack (FE + BE)":
        tier2_reasons.append("Full-stack FE + BE wire boundary (requires real-payload verification)")
        risk_dim_keys.add("fullstack")

    if len(modules) >= 4 or len(non_test_files) >= 15:
        tier3_reasons.append(f"Wide blast radius ({len(modules)} modules, {len(non_test_files)} non-test files)")
    elif len(modules) >= 2 or len(non_test_files) >= 5:
        tier2_reasons.append(f"Multi-module scope ({len(modules)} modules, {len(non_test_files)} non-test files)")

    for dim, hit in t2_summary:
        msg = f"Prompt signal: {hit}"
        if msg not in tier2_reasons:
            tier2_reasons.append(msg)
        if dim != "ui_complex":
            risk_dim_keys.add(dim)
    for hit in t3_summary:
        tier3_reasons.append(f"Prompt signal: {hit}")

    if len(risk_dim_keys) >= 3:
        tier3_reasons.append(f"Combines {len(risk_dim_keys)} independent risk dimensions ({', '.join(sorted(risk_dim_keys))})")

    if tier3_reasons:
        tier = 3
        tier_name = "Tier 3 (FULL RIGOR)"
        run_tools = [
            "Upfront: /pstack:how + /pstack:architect (2 sketches) [+ /pstack:statechart if stateful]",
            "Build: keep your current build model + ponytail discipline in verifiable commits",
        ]
        if has_ui:
            run_tools.append(
                "UI Gate (BEFORE council): Layer 1 ($0 DOM Oracle) + Layer 2 (~$0.04-0.20 Blind Visual & Heuristic Critic) + Layer 3 Chartered Exploratory UX Pass -> pass Layer 1/2 findings to council seats"
            )
        interrogate_clause = (
            " + runnable /pstack:interrogate (proof-only for BE/security)"
            if ("Backend" in stack or "Full-Stack" in stack or "auth_money" in risk_dim_keys)
            else ""
        )
        run_tools.append(
            f"Review: ponytail-review trim -> /pstack:blast-radius{interrogate_clause} -> 3-Model Council (fresh-context GPT-6.2-Sol High on codex + Gemini 4 Neon High on antigravity + Claude Opus 5.5 High on native claudeAgent effort:high, never Antigravity; HARD CAP 3 rounds)"
        )
        skip_tools = [
            "SKIP /pstack:arena full-code duplicate builds unless explicitly requested",
            "NEVER route Claude Opus through Antigravity and NEVER exceed 3 council rounds",
        ]
    elif tier2_reasons:
        tier = 2
        tier_name = "Tier 2 (TARGETED RIGOR)"
        run_tools = [
            "Upfront: /pstack:how (1 read-only explorer) + Layer 0 real payload/DOM check -> 5-bullet Design Lock",
            "Build: keep your current build model + ponytail discipline + real-payload tests (happy + 404/empty + error)",
        ]
        if has_ui:
            run_tools.append(
                "UI Gate (BEFORE council): Layer 1 ($0 DOM Oracle across desktop+mobile) + Layer 2 (~$0.04-0.20 Blind Visual & Heuristic Critic -> auto-fix Bucket A + rank Bucket B) -> pass findings to both council seats to cross-check against code"
            )
        run_tools.append(
            "Review: ponytail-review trim -> 2-Model Fast Council locked to fresh-context GPT-6.2-Sol High (codex, reasoningEffort:high) + Gemini 4 Neon High (antigravity, thought_level:high) regardless of implementor (max 2 rounds; do not run 3-model /council) [+ /pstack:blast-radius if risky BE]"
        )
        skip_tools = [
            "SKIP 3rd Opus council seat unless a blocker is disputed",
            "SKIP /pstack:arena, /pstack:statechart (unless complex races), and 60-turn static interrogate",
        ]
    else:
        tier = 1
        tier_name = "Tier 1 (LEAN)"
        run_tools = [
            "Build: keep your current build model + direct local read + ponytail discipline + 1 focused behavior test",
        ]
        if has_ui:
            run_tools.append("UI Gate (BEFORE review): Layer 1 ($0 DOM Oracle) + quick Layer 2 (~$0.04-0.20 Blind Visual Critic)")
        run_tools.append("Review: ponytail-review (~$0.50-$1) OR 1 sol-loop (max 2 rounds, stop on nits)")
        skip_tools = [
            "SKIP /pstack:how fan-out, /pstack:architect, /pstack:arena, /pstack:statechart, /pstack:interrogate, and /council",
        ]

    if args.kind == "review":
        run_tools = ["Review mode: read-only, skip Upfront/Build/Design Lock"] + [
            s.replace("auto-fix Bucket A", "report Bucket A")
            for s in run_tools
            if not s.startswith(("Upfront:", "Build:"))
        ]

    missing, skill_notes = inspect_skills()
    if missing:
        run_tools.append(
            "Not installed: " + ", ".join(missing) + " -> use the matching row in SKILL.md 'If a skill is not installed'"
        )
    for note in skill_notes:
        run_tools.append(f"Skill note: {note}")

    reasons = tier3_reasons + tier2_reasons
    if scope_incomplete:
        reasons.append(
            "Scope incomplete: no diff found and repo has >40 tracked files; pass --base <ref> or --files <paths> to inspect target files"
        )
    if not reasons:
        reasons = ["Isolated single-module change with no shared callers, boundary contracts, or async primitives"]

    return {
        "tier": tier,
        "tier_name": tier_name,
        "stack": stack,
        "has_ui": has_ui,
        "kind": args.kind,
        "base_ref": base_ref or "(working tree / tracked files)",
        "files_analyzed": len(non_test_files),
        "scope_incomplete": scope_incomplete,
        "modules": modules,
        "shared_files": shared_files,
        "boundary_files": boundary_hits,
        "caller_fanout": caller_fanout,
        "has_async_primitives": has_async,
        "reasons": reasons,
        "run": run_tools,
        "missing_skills": missing,
        "skill_notes": skill_notes,
        "skip": skip_tools,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Project-agnostic 3-Tier Change Impact Analysis router")
    parser.add_argument("--repo", help="Path to git repository")
    parser.add_argument("--base", default="", help="Base git ref (default: auto main/master)")
    parser.add_argument("--kind", choices=["feature", "bug", "hotfix", "refactor", "review"], default="feature")
    parser.add_argument("--files", action="append", default=[], help="Candidate file path(s), comma-separated or repeated")
    parser.add_argument("--summary", default="", help="Short task description")
    parser.add_argument("--failed-attempts", type=int, default=0, help="Prior failed fix attempts on same issue")
    parser.add_argument("--no-git-diff", action="store_true", help="Ignore git diff (pre-coding summary triage)")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    res = recommend(args)
    if args.json:
        print(json.dumps(res, indent=2))
        return 0

    print(f"TIER:  {res['tier_name']}")
    print(f"STACK: {res['stack']} (UI gate: {'ON' if res['has_ui'] else 'OFF'})")
    print(f"SCOPE: {res['files_analyzed']} non-test files across {len(res['modules'])} module(s): {', '.join(res['modules']) or '(none)'}")
    print("\nWHY:")
    for r in res["reasons"]:
        print(f"  - {r}")
    print("\nRUN:")
    for s in res["run"]:
        print(f"  - {s}")
    print("\nSKIP (TOKEN GUARD):")
    for s in res["skip"]:
        print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
