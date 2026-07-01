"""repo-rules plugin — explicit repo-local context, not speculative extraction.

Stores user-authored rules under ``<repo>/.hermes/repo-rules.json`` and injects
those rules into the current turn through the ``pre_llm_call`` hook.
"""

from __future__ import annotations

import logging
import shlex
from pathlib import Path
from typing import Any, Optional

from . import repo_rules as rr

logger = logging.getLogger(__name__)

_HELP_TEXT = """\
/repo-rule — explicit repo-local rules

Subcommands:
  list                    Show saved rules for the current repo
  add <text>              Add a rule for the current repo
  remove <n|exact text>   Remove a rule by 1-based index or exact text
  clear                   Delete all saved rules for the current repo
  path                    Show the backing rules file path

Storage:
  <repo>/.hermes/repo-rules.json

Notes:
  - Rules are injected via pre_llm_call into the current turn only.
  - Nothing is auto-extracted from conversation history.
  - Outside a git repo, the plugin is a silent no-op.
"""


def _fmt_path(path: Path) -> str:
    return str(path)


def _handle_list() -> str:
    path = rr.resolve_rules_file()
    if path is None:
        return "[repo-rule] Not inside a git repo."

    rules = rr.load_rules(path)
    if not rules:
        return f"[repo-rule] No repo rules saved at {_fmt_path(path)}"

    lines = [f"[repo-rule] {_fmt_path(path)}"]
    lines.extend(f"{idx}. {rule}" for idx, rule in enumerate(rules, start=1))
    return "\n".join(lines)


def _handle_slash(raw_args: str) -> Optional[str]:
    try:
        argv = shlex.split(raw_args or "", posix=True)
    except ValueError as exc:
        return f"[repo-rule] Could not parse arguments: {exc}\n\n{_HELP_TEXT}"
    if not argv or argv[0] in {"help", "-h", "--help"}:
        return _HELP_TEXT

    sub = argv[0]

    if sub == "list":
        return _handle_list()

    if sub == "path":
        path = rr.resolve_rules_file()
        if path is None:
            return "[repo-rule] Not inside a git repo."
        return f"[repo-rule] Rules file: {_fmt_path(path)}"

    if sub == "add":
        text = " ".join(argv[1:]).strip()
        if not text:
            return "Usage: /repo-rule add <text>"
        try:
            path, rule, created, position = rr.add_rule(text)
        except ValueError as exc:
            return f"[repo-rule] {exc}"
        if created:
            return (
                f"[repo-rule] Added repo rule #{position} at {_fmt_path(path)}\n"
                f"  {rule}"
            )
        return (
            f"[repo-rule] Rule already exists at {_fmt_path(path)}\n"
            f"  {rule}"
        )

    if sub == "remove":
        selector = " ".join(argv[1:]).strip()
        if not selector:
            return "Usage: /repo-rule remove <n|exact text>"
        try:
            path, removed, remaining = rr.remove_rule(selector)
        except (LookupError, ValueError) as exc:
            return f"[repo-rule] {exc}"
        return (
            f"[repo-rule] Removed repo rule from {_fmt_path(path)} "
            f"({remaining} remaining)\n  {removed}"
        )

    if sub == "clear":
        try:
            path, removed_count = rr.clear_rules()
        except ValueError as exc:
            return f"[repo-rule] {exc}"
        return f"[repo-rule] Cleared {removed_count} repo rule(s) from {_fmt_path(path)}"

    return f"Unknown subcommand: {sub}\n\n{_HELP_TEXT}"


def _on_pre_llm_call(user_message: str = "", **_: Any) -> Optional[dict[str, str]]:
    try:
        context = rr.build_injection_context()
    except Exception as exc:
        logger.warning("repo-rules pre_llm_call failed: %s", exc)
        return None
    if not context:
        return None
    return {"context": context}


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_command(
        "repo-rule",
        handler=_handle_slash,
        description="Manage explicit repo-local rules for the current git checkout.",
    )
