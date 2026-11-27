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
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

UI_EXTS = {".tsx", ".jsx", ".vue", ".svelte", ".html", ".css", ".scss", ".less"}
CODE_EXTS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
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
ASYNC_CONCURRENCY_RE = re.compile(
    r"\b(setInterval|setTimeout|visibilitychange|document\.hidden|EventSource|"
    r"WebSocket|AbortController|Promise\.all|Promise\.race|mutex|Mutex|sync\.WaitGroup|"
    r"asyncio\.gather|threading\.Lock|transaction|BEGIN\s+TRANSACTION|optimistic|"
    r"debounce|throttle)\b"
)
TIER2_SUMMARY_SIGNALS: List[Tuple[str, str]] = [
    (r"\b(hotfix|live issue|live bug|production|prod bug|incident|outage)\b", "Production bug / hotfix"),
    (r"\b(api|endpoint|contract|schema|migration|database|sql|payload|mock|404)\b", "API / data contract boundary"),
    (r"\b(auth|login|oauth|token|permission|rbac|security|billing|payment|money)\b", "Auth / security / billing boundary"),
    (r"\b(shared|common|core|refactor callers|across pages|multiple screens)\b", "Shared component or multi-caller scope"),
    (r"\b(race|async|polling|timer|websocket|stream|reload|optimistic|filter|concurrent)\b", "Async / timing / state coordination"),
    (r"\b(ui|ux|polish|visual|layout|responsive|mobile|dashboard|modal|redesign)\b", "Visible UI / UX polish surface"),
]
TIER3_SUMMARY_SIGNALS: List[Tuple[str, str]] = [
    (r"\b(multi-?pr|rewrite|overhaul|architecture|migration|stacked|orchestrat)\b", "Multi-PR or architectural rewrite"),
    (r"\b(state machine|race condition|distributed|multi-?tab|concurrency|deadlock)\b", "Complex state machine or concurrency"),
    (r"\b(security audit|cryptography|data migration|zero-?downtime)\b", "High-stakes security or data migration"),
]


def run_git(repo: Path, args: List[str]) -> Tuple[int, str]:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return proc.returncode, proc.stdout.strip()
    except Exception as exc:
        return 2, str(exc)


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
    if parts[0] in ("src", "app", "packages", "apps", "services", "internal", "pkg") and len(parts) >= 2:
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


def get_changed_files(repo: Path, base_ref: str) -> Tuple[List[str], str]:
    merge_base = ""
    if base_ref:
        rc, out = run_git(repo, ["merge-base", "HEAD", base_ref])
        if rc == 0 and out:
            merge_base = out
    files: Set[str] = set()
    if merge_base:
        rc, diff_out = run_git(repo, ["diff", "--name-only", f"{merge_base}...HEAD"])
        if rc == 0 and diff_out:
            files.update(line.strip() for line in diff_out.splitlines() if line.strip())
    rc_st, st_out = run_git(repo, ["status", "--porcelain"])
    if rc_st == 0 and st_out:
        for line in st_out.splitlines():
            if len(line) > 3:
                path_part = line[3:].strip()
                if " -> " in path_part:
                    path_part = path_part.split(" -> ", 1)[1].strip()
                files.add(path_part)
    # If repo has a clean working tree and no branch diff against base, inspect tracked files (review-whole-app mode)
    if not files and repo.is_dir():
        rc_ls, ls_out = run_git(repo, ["ls-files"])
        if rc_ls == 0 and ls_out:
            tracked = [l.strip() for l in ls_out.splitlines() if l.strip()]
            if len(tracked) <= 40:
                files.update(tracked)
    return sorted(files), merge_base


def scan_caller_fanout(repo: Path, candidate_files: List[str]) -> Dict[str, List[str]]:
    fanout: Dict[str, List[str]] = {}
    for f in candidate_files[:20]:
        p = Path(f)
        if p.suffix.lower() not in CODE_EXTS:
            continue
        stem = p.stem if p.stem not in ("index", "__init__", "main", "mod", "app", "server") else p.parent.name
        if not stem or len(stem) < 4:
            continue
        rc, out = run_git(repo, ["grep", "-l", "-F", stem])
        if rc != 0 or not out:
            continue
        caller_mods: Set[str] = set()
        for hit in out.splitlines():
            if hit == f or is_test_or_doc(hit) or Path(hit).suffix.lower() not in (CODE_EXTS | UI_EXTS):
                continue
            caller_mods.add(module_bucket(hit))
        if len(caller_mods) >= 3:
            fanout[f] = sorted(caller_mods)
    return fanout


def detect_async_and_stack(repo: Path | None, files: List[str]) -> Tuple[bool, str, List[str]]:
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
            k in f"/{norm.lower()}" for k in ("/server", "/backend", "/api/", "server.js", "server.ts", "app.py")
        ):
            has_be = True
        if BOUNDARY_PATH_RE.search(norm):
            boundary_hits.append(norm)
        if repo and ext in (CODE_EXTS | UI_EXTS):
            fp = repo / norm
            if fp.is_file():
                try:
                    txt = fp.read_text(errors="ignore")
                    if ASYNC_CONCURRENCY_RE.search(txt):
                        has_async = True
                except OSError:
                    pass

    if has_ui and has_be:
        stack = "Full-Stack (FE + BE)"
    elif has_ui:
        stack = "Frontend / UI"
    elif has_be:
        stack = "Backend / Service / CLI"
    else:
        stack = "General Code / Scripts"
    return has_async, stack, boundary_hits


def recommend(args: argparse.Namespace) -> Dict:
    repo = Path(args.repo).expanduser().resolve() if args.repo else None
    files: List[str] = []
    for item in args.files:
        for part in item.split(","):
            if part.strip():
                files.append(part.strip())

    base_ref = ""
    if repo and repo.is_dir() and not args.no_git_diff:
        base_ref = detect_default_base(repo, args.base or "")
        git_files, _ = get_changed_files(repo, base_ref)
        files = sorted(set(files) | set(git_files))

    non_test_files = [f for f in files if not is_test_or_doc(f)]
    modules = sorted({module_bucket(f) for f in non_test_files})
    shared_files = [f for f in non_test_files if is_shared_file(f)]
    caller_fanout = scan_caller_fanout(repo, shared_files or non_test_files) if (repo and non_test_files) else {}
    has_async, stack, boundary_hits = detect_async_and_stack(repo, non_test_files)

    summary_low = (args.summary or "").lower()
    t2_summary = [label for pat, label in TIER2_SUMMARY_SIGNALS if re.search(pat, summary_low)]
    t3_summary = [label for pat, label in TIER3_SUMMARY_SIGNALS if re.search(pat, summary_low)]

    tier2_reasons: List[str] = []
    tier3_reasons: List[str] = []
    risk_dims = 0

    if args.failed_attempts >= 2:
        tier3_reasons.append(f"Circuit breaker: {args.failed_attempts} failed attempts (Attack the Premise)")

    if args.kind == "hotfix":
        tier2_reasons.append("Production hotfix (needs root-cause repro + blast-radius proof)")
        risk_dims += 1
    elif args.kind == "bug" and (len(non_test_files) != 1 or shared_files or boundary_hits):
        tier2_reasons.append("Multi-file or boundary bug fix (reproduce before patching)")

    if caller_fanout:
        top = ", ".join(f"{k} ({len(v)} modules)" for k, v in list(caller_fanout.items())[:3])
        tier2_reasons.append(f"High caller fan-out: {top}")
        risk_dims += 1
    elif shared_files and (len(non_test_files) >= 2 or not args.no_git_diff):
        tier2_reasons.append(f"Touches shared modules: {', '.join(shared_files[:4])}")

    if boundary_hits:
        tier2_reasons.append(f"Contract/boundary files: {', '.join(boundary_hits[:4])}")
        risk_dims += 1

    if has_async:
        tier2_reasons.append("Async / network / concurrency primitives detected (race & reload risk)")
        risk_dims += 1

    if stack == "Full-Stack (FE + BE)":
        tier2_reasons.append("Full-stack FE + BE wire boundary (requires real-payload verification)")
        risk_dims += 1

    if len(modules) >= 4 or len(non_test_files) >= 15:
        tier3_reasons.append(f"Wide blast radius ({len(modules)} modules, {len(non_test_files)} non-test files)")
    elif len(modules) >= 2 or len(non_test_files) >= 5:
        tier2_reasons.append(f"Multi-module scope ({len(modules)} modules, {len(non_test_files)} non-test files)")

    for hit in t2_summary:
        if hit not in tier2_reasons:
            tier2_reasons.append(f"Prompt signal: {hit}")
    for hit in t3_summary:
        tier3_reasons.append(f"Prompt signal: {hit}")

    if risk_dims >= 3:
        tier3_reasons.append(f"Combines {risk_dims} independent risk dimensions")

    has_ui = "Frontend" in stack or "Full-Stack" in stack or any("UI" in h for h in t2_summary)

    if tier3_reasons:
        tier = 3
        tier_name = "Tier 3 (FULL RIGOR)"
        run_tools = [
            "Upfront: /pstack:how + /pstack:architect (2 sketches) [+ /pstack:statechart if stateful]",
            "Build: ponytail discipline in verifiable commits",
            "Review: ponytail-review trim -> /pstack:blast-radius -> 3-Model /council (HARD CAP 3 rounds) OR runnable /pstack:interrogate for BE/security",
        ]
        if has_ui:
            run_tools.append("UI Gate: Layer 1 ($0 DOM Oracle) + Layer 2 (~$0.20 Blind Visual & Heuristic Critic) + Layer 3 Chartered Exploratory UX Pass")
        skip_tools = [
            "SKIP /pstack:arena full-code duplicate builds unless explicitly requested",
            "NEVER exceed 3 council rounds (escalate premise instead)",
        ]
    elif tier2_reasons:
        tier = 2
        tier_name = "Tier 2 (TARGETED RIGOR)"
        run_tools = [
            "Upfront: /pstack:how (1 read-only explorer) + Layer 0 real payload/DOM check -> 5-bullet Design Lock",
            "Build: ponytail discipline + real-payload tests (happy + 404/empty + error)",
            "Review: ponytail-review trim -> 2-Model Fast Council (Gemini 4 Neon High + GPT-6.2-Sol High, max 2 rounds) [+ /pstack:blast-radius if risky BE]",
        ]
        if has_ui:
            run_tools.append("UI Gate: Layer 1 ($0 DOM Oracle across desktop+mobile) + Layer 2 (~$0.20 Blind Visual & Heuristic Critic -> auto-fix Bucket A + rank Bucket B)")
        skip_tools = [
            "SKIP 3rd Opus council seat unless a blocker is disputed",
            "SKIP /pstack:arena, /pstack:statechart (unless complex races), and 60-turn static interrogate",
        ]
    else:
        tier = 1
        tier_name = "Tier 1 (LEAN)"
        run_tools = [
            "Build: direct local read + ponytail discipline + 1 focused behavior test",
            "Review: ponytail-review (~$0.50-$1) OR 1 sol-loop (max 2 rounds, stop on nits)",
        ]
        if has_ui:
            run_tools.append("UI Gate: Layer 1 ($0 DOM Oracle) + quick Layer 2 Blind Visual Critic")
        skip_tools = [
            "SKIP /pstack:how fan-out, /architect, /arena, /statechart, /interrogate, and /council",
        ]

    return {
        "tier": tier,
        "tier_name": tier_name,
        "stack": stack,
        "has_ui": has_ui,
        "kind": args.kind,
        "base_ref": base_ref or "(working tree / tracked files)",
        "files_analyzed": len(non_test_files),
        "modules": modules,
        "shared_files": shared_files,
        "boundary_files": boundary_hits,
        "caller_fanout": caller_fanout,
        "has_async_primitives": has_async,
        "reasons": tier3_reasons + tier2_reasons or ["Isolated single-module change with no shared callers, boundary contracts, or async primitives"],
        "run": run_tools,
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
