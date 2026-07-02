#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
EXPECTED_CANONICAL = Path(MANIFEST["canonical_repo"])
APP_ROOT = Path(MANIFEST["app_root"])
REQUIRED_FILES = [
    "SKILL.md",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "manifest.json",
    "validate_skill.py",
    "install_skill.py",
    "evals/trigger-cases.json",
    "LICENSE",
]
REQUIRED_HEADINGS = [
    "## When to Use",
    "## Actual Tool Surface Today",
    "## Required Workflow",
    "## Reporting Rules",
    "## Agent Handoff Packet",
    "## Exit Codes",
    "## Verification Checklist",
]
REQUIRED_STOPS = [
    "### Stop 0 - Scan frame",
    "### Stop 1 - Build or use the built artifact",
    "### Stop 2 - Coverage check",
    "### Stop 3 - Geometry review",
    "### Stop 4 - Hypothesis triage",
    "### Stop 5 - Produce the handoff packet",
    "### Stop 6 - Compare against a baseline when needed",
]
REQUIRED_PHRASES = [
    "These are structural risk hypotheses derived from graph evidence. They are not confirmed defects until reproduced or proven by a focused audit.",
    "Do not invent `graph`, `run`, `inspect`, or `validate` commands",
    "Use CENTER-MULTIGEOMETRY to choose the next case. Use CENTER-AUDIT to prove it.",
]
EXPECTED_TOP_KEYS = {
    "schema_version",
    "tool_version",
    "scan_frame",
    "count",
    "raw_signal_count",
    "coverage",
    "engine_runs",
    "signals",
    "hypotheses",
    "warnings",
}
EXPECTED_DIFF_KEYS = {
    "schema_version",
    "base_path",
    "head_path",
    "base_count",
    "head_count",
    "new_hypotheses",
    "resolved_hypotheses",
    "changed_hypotheses",
    "unchanged_count",
}
EXPECTED_REPORT_FILES = {"report.json", "report.md", "report.sarif"}
NODE_BIN = shutil.which("node") or shutil.which("node.exe") or r"C:/Program Files/nodejs/node.exe"
NPM_BIN = shutil.which("npm.cmd") or shutil.which("npm") or r"C:/Program Files/nodejs/npm.cmd"
EXPECTED_TARGETS = {
    "hermes": ("C:/Hermes/skills/software-development/center-multigeometry", "skill_md_only"),
    "mavis": ("C:/Users/zerop/.mavis/skills/center-multigeometry", "skill_md_only"),
    "opencode": ("C:/Users/zerop/.config/opencode/skills/center-multigeometry", "full"),
    "claude": ("C:/Users/zerop/.claude/skills/center-multigeometry", "full"),
    "codex": ("C:/Users/zerop/.codex/skills/center-multigeometry", "full"),
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    m = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.S)
    if not m:
        raise ValueError("frontmatter block missing or malformed")
    front, body = m.group(1), m.group(2)
    out: dict[str, str] = {}
    for line in front.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and not line.startswith("  "):
            out[key] = value
    return out, body


def validate_bundle() -> list[str]:
    problems: list[str] = []

    for rel in REQUIRED_FILES:
        if not (ROOT / rel).exists():
            problems.append(f"missing required file: {rel}")

    if problems:
        return problems

    skill_text = read(ROOT / "SKILL.md")
    manifest = json.loads(read(ROOT / "manifest.json"))
    trigger_cases = json.loads(read(ROOT / "evals/trigger-cases.json"))

    try:
        front, _body = parse_frontmatter(skill_text)
    except ValueError as e:
        return [str(e)]

    desc = front.get("description", "")
    if front.get("name") != "center-multigeometry":
        problems.append("SKILL.md name must be center-multigeometry")
    if manifest.get("name") != "center-multigeometry":
        problems.append("manifest name must be center-multigeometry")
    if manifest.get("skill_name") != "center-multigeometry":
        problems.append("manifest skill_name must be center-multigeometry")
    if manifest.get("category") != "software-development":
        problems.append("manifest category must be software-development")
    if manifest.get("description") != desc:
        problems.append("manifest description must match SKILL.md description")
    if len(desc) > 60:
        problems.append(f"description too long for Hermes runtime cap: {len(desc)} > 60")

    if manifest.get("canonical_repo") != EXPECTED_CANONICAL.as_posix():
        problems.append(
            f"canonical_repo mismatch: {manifest.get('canonical_repo')} != {EXPECTED_CANONICAL.as_posix()}"
        )
    if not EXPECTED_CANONICAL.exists():
        problems.append(f"canonical_repo missing on disk: {EXPECTED_CANONICAL.as_posix()}")

    if manifest.get("app_root") != APP_ROOT.as_posix():
        problems.append(f"app_root mismatch: {manifest.get('app_root')} != {APP_ROOT.as_posix()}")
    if not APP_ROOT.exists():
        problems.append(f"app_root missing on disk: {APP_ROOT.as_posix()}")

    for spec_path in manifest.get("spec_sources", []):
        if not Path(spec_path).exists():
            problems.append(f"missing spec source: {spec_path}")

    for heading in REQUIRED_HEADINGS:
        if heading not in skill_text:
            problems.append(f"missing heading in SKILL.md: {heading}")
    for stop in REQUIRED_STOPS:
        if stop not in skill_text:
            problems.append(f"missing workflow stop in SKILL.md: {stop}")
    for phrase in REQUIRED_PHRASES:
        if phrase not in skill_text:
            problems.append(f"missing required phrase in SKILL.md: {phrase}")

    targets = manifest.get("distribution", {}).get("targets", [])
    target_map = {item.get("id"): (item.get("path"), item.get("mode")) for item in targets}
    if set(target_map) != set(EXPECTED_TARGETS):
        problems.append(f"target ids mismatch: {sorted(target_map)}")
    else:
        for target_id, expected in EXPECTED_TARGETS.items():
            if target_map[target_id] != expected:
                problems.append(f"target mismatch for {target_id}: {target_map[target_id]} != {expected}")

    if not isinstance(trigger_cases, list) or len(trigger_cases) < 8:
        problems.append("evals/trigger-cases.json must be a JSON array with at least 8 cases")
    else:
        positives = 0
        negatives = 0
        for index, case in enumerate(trigger_cases):
            if not isinstance(case, dict):
                problems.append(f"trigger case {index} must be an object")
                continue
            if not isinstance(case.get("query"), str) or not case["query"].strip():
                problems.append(f"trigger case {index} needs a non-empty string query")
            if not isinstance(case.get("should_trigger"), bool):
                problems.append(f"trigger case {index} needs boolean should_trigger")
                continue
            if case["should_trigger"]:
                positives += 1
            else:
                negatives += 1
        if positives == 0 or negatives == 0:
            problems.append("trigger cases must include both positive and negative examples")

    return problems


def run_cmd(args: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def run_e2e() -> list[str]:
    problems: list[str] = []

    build = run_cmd([NPM_BIN, "run", "build"], APP_ROOT, 300)
    if build.returncode != 0:
        problems.append("npm run build failed")
        problems.append((build.stdout + build.stderr)[-800:])
        return problems

    help_proc = run_cmd([NODE_BIN, "dist/cli/main.js", "--help"], APP_ROOT, 120)
    if help_proc.returncode != 0:
        problems.append("center-geo --help failed")
        problems.append((help_proc.stdout + help_proc.stderr)[-800:])
        return problems
    help_text = help_proc.stdout + help_proc.stderr
    for token in ["Commands:", "scan", "diff", "index"]:
        if token not in help_text:
            problems.append(f"--help missing expected token: {token}")

    outdir = APP_ROOT / ".hermes" / "skill-selftest-center-multigeometry"
    if outdir.exists():
        shutil.rmtree(outdir)

    scan = run_cmd(
        [NODE_BIN, "dist/cli/main.js", "scan", ".", "--format", "json", "--output-dir", str(outdir)],
        APP_ROOT,
        300,
    )
    if scan.returncode not in {0, 1}:
        problems.append(f"scan exit code unexpected: {scan.returncode}")
        problems.append((scan.stdout + scan.stderr)[-1200:])
        return problems

    try:
        scan_obj = json.loads(scan.stdout)
    except json.JSONDecodeError as e:
        problems.append(f"scan stdout is not valid JSON: {e}")
        problems.append(scan.stdout[:800])
        return problems

    if set(scan_obj.keys()) != EXPECTED_TOP_KEYS:
        problems.append(f"scan top-level keys mismatch: {sorted(scan_obj.keys())}")
    if not scan_obj.get("engine_runs"):
        problems.append("scan JSON contains no engine_runs")
    if not scan_obj.get("hypotheses"):
        problems.append("scan JSON contains no hypotheses on self-scan; expected at least one")
    if "wrote reports to" not in scan.stderr:
        problems.append("scan stderr missing output-dir confirmation")

    if not outdir.exists():
        problems.append(f"scan output dir missing: {outdir}")
        return problems
    actual_reports = {p.name for p in outdir.iterdir() if p.is_file()}
    if actual_reports != EXPECTED_REPORT_FILES:
        problems.append(f"report files mismatch: {sorted(actual_reports)}")
        return problems

    report_md = (outdir / "report.md").read_text(encoding="utf-8")
    disclaimer = "These are structural risk hypotheses derived from graph evidence. They are not confirmed defects until reproduced or proven by a focused audit."
    if disclaimer not in report_md:
        problems.append("report.md missing structural-risk disclaimer")

    diff = run_cmd(
        [NODE_BIN, "dist/cli/main.js", "diff", str(outdir / "report.json"), str(outdir / "report.json")],
        APP_ROOT,
        120,
    )
    if diff.returncode != 0:
        problems.append(f"diff exit code unexpected: {diff.returncode}")
        problems.append((diff.stdout + diff.stderr)[-1200:])
        return problems

    try:
        diff_obj = json.loads(diff.stdout)
    except json.JSONDecodeError as e:
        problems.append(f"diff stdout is not valid JSON: {e}")
        problems.append(diff.stdout[:800])
        return problems

    if set(diff_obj.keys()) != EXPECTED_DIFF_KEYS:
        problems.append(f"diff top-level keys mismatch: {sorted(diff_obj.keys())}")
    if diff_obj.get("new_hypotheses") != []:
        problems.append("diff self-compare produced unexpected new_hypotheses")
    if diff_obj.get("changed_hypotheses") != []:
        problems.append("diff self-compare produced unexpected changed_hypotheses")
    if "# decision:" not in diff.stderr:
        problems.append("diff stderr missing human decision line")

    return problems


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Validate the center-multigeometry skill bundle.")
    ap.add_argument("--selftest", action="store_true", help="run end-to-end skill + CLI validation")
    args = ap.parse_args(argv)

    problems = validate_bundle()
    if args.selftest and not problems:
        problems.extend(run_e2e())

    if problems:
        if args.selftest:
            print("[FAIL] center-multigeometry selftest")
        for item in problems:
            print(f"- {item}")
        return 1

    if args.selftest:
        print("[OK] center-multigeometry selftest passed")
    else:
        print("center-multigeometry bundle validates clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
