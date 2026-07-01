from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable, Optional

from utils import atomic_json_write

logger = logging.getLogger(__name__)

_RULES_SUBPATH = Path(".hermes") / "repo-rules.json"
MAX_INJECTION_CHARS = 1200
MAX_INJECTION_RULES = 12


def _normalize_rule(text: str) -> str:
    return " ".join(str(text or "").replace("\r", "\n").split()).strip()


def _dedupe_rules(rules: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in rules:
        normalized = _normalize_rule(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _current_session_dir() -> Optional[Path]:
    candidates = [os.environ.get("TERMINAL_CWD")]
    try:
        candidates.append(os.getcwd())
    except OSError:
        pass

    for raw in candidates:
        if not raw:
            continue
        try:
            path = Path(raw).expanduser()
        except Exception:
            continue
        if path.exists():
            return path if path.is_dir() else path.parent
    return None


def resolve_repo_root(start_dir: Path | str | None = None) -> Optional[Path]:
    base = Path(start_dir).expanduser() if start_dir is not None else _current_session_dir()
    if base is None:
        return None
    if not base.is_dir():
        base = base.parent

    for candidate in (base, *base.parents):
        git_marker = candidate / ".git"
        if git_marker.exists():
            return candidate
    return None


def resolve_rules_file(start_dir: Path | str | None = None) -> Optional[Path]:
    repo_root = resolve_repo_root(start_dir)
    if repo_root is None:
        return None
    return repo_root / _RULES_SUBPATH


def load_rules(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("repo-rules: failed to parse %s: %s", path, exc)
        return []

    if isinstance(payload, dict):
        raw_rules = payload.get("rules", [])
    elif isinstance(payload, list):
        raw_rules = payload
    else:
        return []

    if not isinstance(raw_rules, list):
        return []
    return _dedupe_rules(str(item) for item in raw_rules)


def save_rules(path: Path, rules: Iterable[str]) -> list[str]:
    normalized = _dedupe_rules(rules)

    if not normalized:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return []

    payload = {"version": 1, "rules": normalized}
    atomic_json_write(path, payload)
    return normalized


def add_rule(text: str, start_dir: Path | str | None = None) -> tuple[Path, str, bool, int]:
    path = resolve_rules_file(start_dir)
    if path is None:
        raise ValueError("not inside a git repo")

    rule = _normalize_rule(text)
    if not rule:
        raise ValueError("empty rule")

    rules = load_rules(path)
    if rule in rules:
        return path, rule, False, rules.index(rule) + 1

    rules.append(rule)
    rules = save_rules(path, rules)
    return path, rule, True, len(rules)


def remove_rule(selector: str, start_dir: Path | str | None = None) -> tuple[Path, str, int]:
    path = resolve_rules_file(start_dir)
    if path is None:
        raise ValueError("not inside a git repo")

    rules = load_rules(path)
    if not rules:
        raise LookupError("no rules saved")

    spec = _normalize_rule(selector)
    if not spec:
        raise ValueError("empty selector")

    idx: Optional[int] = None
    if spec.isdigit():
        candidate = int(spec) - 1
        if 0 <= candidate < len(rules):
            idx = candidate
        else:
            raise LookupError("rule index out of range")
    else:
        for i, rule in enumerate(rules):
            if rule == spec:
                idx = i
                break
        if idx is None:
            raise LookupError("rule not found")

    removed = rules.pop(idx)
    remaining = save_rules(path, rules)
    return path, removed, len(remaining)


def clear_rules(start_dir: Path | str | None = None) -> tuple[Path, int]:
    path = resolve_rules_file(start_dir)
    if path is None:
        raise ValueError("not inside a git repo")

    existing = load_rules(path)
    save_rules(path, [])
    return path, len(existing)


def build_injection_context(
    start_dir: Path | str | None = None,
    *,
    max_chars: int = MAX_INJECTION_CHARS,
    max_rules: int = MAX_INJECTION_RULES,
) -> Optional[str]:
    path = resolve_rules_file(start_dir)
    if path is None:
        return None

    rules = load_rules(path)
    if not rules:
        return None

    header = "Repository rules for this checkout:"
    lines: list[str] = []
    for rule in rules[:max_rules]:
        candidate = f"- {rule}"
        trial = header if not lines else header + "\n" + "\n".join(lines + [candidate])
        if len(trial) > max_chars:
            break
        lines.append(candidate)

    if not lines:
        return None
    return header + "\n" + "\n".join(lines)
