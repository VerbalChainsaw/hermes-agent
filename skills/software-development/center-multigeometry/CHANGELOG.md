# Changelog

## 1.0.0 - 2026-07-02

- initial `center-multigeometry` skill landing from the CENTER-MULTIGEOMETRY requirements package
- kept the SKILL body self-contained so Hermes and Mavis SKILL-only installs remain usable
- added `validate_skill.py` end-to-end selftest against the real built `center-geo` CLI
- added `install_skill.py` fan-out to Hermes, Mavis, OpenCode, Claude Code, and Codex roots
- grounded the skill in the live `scan` and `diff` commands instead of older aspirational CLI sketches
