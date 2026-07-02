# center-multigeometry

Canonical git-tracked source for the `center-multigeometry` skill.

Purpose: use the built `center-geo` CLI to produce structural risk maps and bounded investigation packets before escalating a lead into `center-audit`.

This bundle is intentionally self-contained. The SKILL.md body does not depend on `references/` files because some distribution targets receive `SKILL.md` only.

## Canonical paths

- Skill source: `C:/hermes/hermes-agent/skills/software-development/center-multigeometry/`
- App root: `C:/hermes/hermes-agent/apps/center-geo/`
- Built CLI: `C:/hermes/hermes-agent/apps/center-geo/dist/cli/main.js`

## Files

- `SKILL.md` — the skill body
- `AGENTS.md` — maintenance rules for this skill bundle
- `CHANGELOG.md` — release history
- `manifest.json` — canonical metadata and distribution targets
- `validate_skill.py` — bundle validator + end-to-end selftest
- `install_skill.py` — installs to Hermes, Mavis, OpenCode, Claude Code, and Codex roots
- `evals/trigger-cases.json` — positive / negative trigger cases for the validator
- `LICENSE` — MIT

## Validate

```bash
python validate_skill.py
python validate_skill.py --selftest
```

The selftest builds `apps/center-geo`, runs the built CLI, parses real JSON stdout, verifies `report.json` / `report.md` / `report.sarif`, and checks `diff` stdout-vs-stderr separation.

## Install

```bash
python install_skill.py --dry-run
python install_skill.py
python install_skill.py --root hermes
python install_skill.py --verify-only
```

## Distribution targets

- `C:/Hermes/skills/software-development/center-multigeometry` — Hermes runtime mirror (SKILL.md only)
- `C:/Users/zerop/.mavis/skills/center-multigeometry` — Mavis (SKILL.md only)
- `C:/Users/zerop/.config/opencode/skills/center-multigeometry` — OpenCode (full copy)
- `C:/Users/zerop/.claude/skills/center-multigeometry` — Claude Code (full copy)
- `C:/Users/zerop/.codex/skills/center-multigeometry` — Codex (full copy)

## Maintenance rules

- Keep the skill named `center-multigeometry`.
- Keep the SKILL.md body self-contained so SKILL-only roots remain usable.
- Validate after every edit.
- Re-install after every edit so downstream roots stay in sync.
- Teach only the live built CLI surface; do not document aspirational commands that are not in `node dist/cli/main.js --help`.
