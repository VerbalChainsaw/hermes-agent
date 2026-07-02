# Agent Rules

This package uses Tessl for repo-local skills.

Before working in `apps/center-geo/`:
- read `tessl.json`
- inspect `.tessl/plugins/**/SKILL.md` for installed repo skills
- treat `tessl.json` and `.tessl/plugins/` as the source of truth
- treat `.agents/`, `.claude/`, and `.github/skills/` as projections, not the canonical plugin payload

Installed repo-local skill lift at the moment:
- `tessl/code-review` (review lenses)
- `jbvc/security-review`
- `coding-agent-helpers/regression-scout`

Activation guidance in this repo:
- after a code change that already seems correct, load `coding-agent-helpers/regression-scout` before calling the packet done
- if the change touched CLI output, report shape, stdout/stderr behavior, config validation, or exit codes, include at least one machine-consumer check and one built-artifact check in the regression pass
- if the change touched tests or changed behavior without obvious coverage, load `review-test-risk`
- if the change touched CLI contracts, schemas, configs, report shapes, or other consumer boundaries, load `review-contract-boundaries`
- if the change touched secrets, auth/authz, input validation, file/network access, or sensitive logging, load `jbvc/security-review`

Center-geo-specific regression anchors:
- prefer `node dist/cli/main.js ...` over source-only proof for CLI-sensitive changes
- verify `scan` / `diff` machine-readable stdout with a real parser when those surfaces change
- verify `report.json`, `report.md`, and `report.sarif` together when `--output-dir` is in play
- after engine or adapter changes, check one downstream consumer (fusion, reports, diff, or snapshots), not just the immediate engine test

Hermes does not auto-follow Tessl pointer files, so keep these instructions plain-English and update them when the plugin set changes.
