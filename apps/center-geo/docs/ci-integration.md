# CI Integration

`center-geo scan` exits with non-zero status when high-severity
signals are found. This makes it easy to wire into a CI pipeline.

## Exit codes (FR10)

| Code | Meaning |
| ---- | ------- |
| 0    | OK — no high-severity signals in the top-N hypotheses. |
| 1    | THRESHOLD — at least one top hypothesis has `maxSeverity >= high`. |
| 2    | EXTRACTION_GAP — at least one source file failed to extract (parse / IO). |
| 3    | CONFIG_ERROR — the config file is invalid. |
| 4    | REPO_READ_ERROR — the repository path is not readable. |
| 5    | INTERNAL — the tool hit an unexpected error. |

For CI gating, use **exit code 1** as "block the PR" and treat any
non-zero exit as "investigate before merging".

## JSON output

`--format json` writes a structured report to **stdout** (and the
one-line summary to **stderr**, so you can `2>/dev/null` the summary
away in CI to get a clean JSON log).

```bash
center-geo scan --format json /path/to/repo > out.json
jq '.hypotheses[] | select(.maxSeverity == "critical")' out.json
```

## File reports (`--output-dir`)

```bash
center-geo scan --output-dir ./cg-out /path/to/repo
ls ./cg-out
# report.json
# report.md
# report.sarif
```

- `report.json` — structured data (same shape as the stdout JSON).
- `report.md` — human-readable markdown table (drop into a PR comment).
- `report.sarif` — SARIF 2.1.0 (drop into a GitHub code-scanning artifact).

## GitHub Actions example

```yaml
# .github/workflows/center-geo.yml
name: center-geo
on:
  pull_request:
    paths: ['src/**', 'package.json']
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx center-geo scan --output-dir ./cg-out .
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: center-geo-report
          path: cg-out/
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: cg-out/report.sarif
```

The workflow will:

- **Block** the PR if `center-geo scan` exits 1 (high-severity signal).
- **Upload** the JSON, Markdown, and SARIF reports as artifacts.
- **Push** the SARIF report to GitHub code scanning for inline PR annotations.

## GitLab CI example

```yaml
center-geo:
  stage: test
  image: node:22
  script:
    - npm ci
    - npx center-geo scan --output-dir ./cg-out .
  artifacts:
    when: always
    paths: [cg-out/]
    reports:
      codequality: cg-out/report.sarif
```

## Pre-commit hook

```bash
#!/bin/sh
# .git/hooks/pre-commit
npx center-geo scan --output-dir /tmp/cg-out --format json .
if [ $? -eq 1 ]; then
  echo "center-geo: high-severity signals detected. See /tmp/cg-out/report.md"
  exit 1
fi
```

## Tuning for noisy repos

`config.scoring.*` knobs let you tune the threshold for "high
severity." Lower numbers = more sensitive. See `examples/center-geometry.config.yaml`
for the default and per-knob guidance.
