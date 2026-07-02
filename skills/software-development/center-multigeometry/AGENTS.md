# Agent Rules for `center-multigeometry`

This bundle is the canonical git-tracked source for the `center-multigeometry` skill.

## Source of truth

When editing this bundle, treat all three as authoritative together:
- `C:/Users/zerop/Downloads/center-multigeometry-requirements/center-multigeometry-requirements/docs/10-skill-draft.md`
- `C:/Users/zerop/Downloads/center-multigeometry-requirements/center-multigeometry-requirements/docs/01-product-requirements.md`
- the live built CLI help / behavior from `C:/hermes/hermes-agent/apps/center-geo/dist/cli/main.js`

The requirements draft gives the doctrine.
The built artifact gives the commands that actually exist.
If they disagree, document the live CLI honestly and keep the doctrine.

## Maintenance constraints

- Keep `SKILL.md` self-contained. Do not add load-bearing `references/` links unless you also redesign install mode; Hermes and Mavis targets receive `SKILL.md` only.
- Do not teach commands that are absent from `node dist/cli/main.js --help`.
- Do not turn hypotheses into confirmed defects in the skill body.
- Do not teach repair steps; escalation goes to `center-audit`.
- Do not leak secrets in examples or copied report excerpts.

## Required verification after every edit

Run, in order:

```bash
python validate_skill.py
python validate_skill.py --selftest
python install_skill.py --verify-only
```

If the skill body changed, also run:

```bash
python install_skill.py
```

## Commit discipline

- Commit only the skill bundle files for this packet.
- Do not bundle unrelated `apps/center-geo/src/**` changes into the skill commit.
- If the app behavior changed and the skill had to change because of it, mention the coupling explicitly in the commit message.
