#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
TARGETS = MANIFEST["distribution"]["targets"]
IGNORE = shutil.ignore_patterns(".git", ".gitignore", "__pycache__", "*.pyc", "*.pyo")
FULL_EXPECTED = {
    "SKILL.md",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "manifest.json",
    "validate_skill.py",
    "install_skill.py",
    "evals/trigger-cases.json",
    "LICENSE",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync_tree(src: Path, dst: Path) -> None:
    for path in src.rglob("*"):
        if ".git" in path.parts or "__pycache__" in path.parts or path.name == ".gitignore" or path.suffix in {".pyc", ".pyo"}:
            continue
        rel = path.relative_to(src)
        out = dst / rel
        if path.is_dir():
            out.mkdir(parents=True, exist_ok=True)
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(path.read_bytes())


def run_selftest(dst: Path) -> tuple[bool, str]:
    script = dst / "validate_skill.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--selftest"],
        cwd=dst,
        capture_output=True,
        text=True,
        timeout=600,
    )
    out = (proc.stdout + proc.stderr).strip()
    return proc.returncode == 0, out.splitlines()[-1] if out else "(no output)"


def copy_target(target: dict, dry_run: bool) -> None:
    dst = Path(target["path"])
    mode = target["mode"]
    if dry_run:
        print(f"[dry-run] {target['id']:8s} -> {dst} ({mode})")
        return
    overlay = False
    if dst.exists():
        try:
            shutil.rmtree(dst)
        except OSError:
            overlay = True
    dst.parent.mkdir(parents=True, exist_ok=True)
    if mode == "skill_md_only":
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "SKILL.md", dst / "SKILL.md")
    else:
        if overlay:
            dst.mkdir(parents=True, exist_ok=True)
            sync_tree(ROOT, dst)
        else:
            shutil.copytree(ROOT, dst, ignore=IGNORE)


def verify_target(target: dict) -> tuple[bool, str]:
    dst = Path(target["path"])
    mode = target["mode"]
    skill_path = dst / "SKILL.md"
    if not skill_path.exists():
        return False, "SKILL.md missing"
    if sha256(skill_path) != sha256(ROOT / "SKILL.md"):
        return False, "SKILL.md hash mismatch"
    if mode == "skill_md_only":
        names = sorted(p.name for p in dst.iterdir())
        if names != ["SKILL.md"]:
            return False, f"skill_md_only root contains extra files: {names}"
        return True, "SKILL.md only + hash match"

    actual = set()
    for path in dst.rglob("*"):
        if path.is_file():
            actual.add(path.relative_to(dst).as_posix())
    if actual != FULL_EXPECTED:
        missing = sorted(FULL_EXPECTED - actual)
        extra = sorted(actual - FULL_EXPECTED)
        return False, f"file-set mismatch missing={missing} extra={extra}"
    ok, out = run_selftest(dst)
    return ok, out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Install center-multigeometry to all local agent skill roots.")
    ap.add_argument("--dry-run", action="store_true", help="show target actions without copying")
    ap.add_argument("--root", choices=[t["id"] for t in TARGETS], help="install or verify a single target")
    ap.add_argument("--verify-only", action="store_true", help="verify existing targets without copying")
    args = ap.parse_args(argv)

    selected = [t for t in TARGETS if not args.root or t["id"] == args.root]
    print(f"[install_skill] dry_run={args.dry_run} verify_only={args.verify_only} roots={[t['id'] for t in selected]}")

    overall_ok = True
    for target in selected:
        dst = Path(target["path"])
        if not args.verify_only:
            try:
                copy_target(target, args.dry_run)
            except OSError as e:
                overall_ok = False
                print(f"[FAIL] {target['id']:8s} copy failed: {e}")
                continue
        if args.dry_run:
            continue
        ok, msg = verify_target(target)
        if ok:
            print(f"[ OK ] {target['id']:8s} {dst} :: {msg}")
        else:
            overall_ok = False
            print(f"[FAIL] {target['id']:8s} {dst} :: {msg}")

    print(f"[install_skill] done — overall {'OK' if overall_ok else 'FAILED'}")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
