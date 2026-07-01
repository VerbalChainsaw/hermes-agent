---
name: codebase-test-suite-audit
description: Use when the user wants a test suite audit, test quality or reliability review, regression-protection review, unit/integration/e2e test review, coverage or CI signal assessment, flaky CI investigation, fixture-realism review, spec-drift review, or generated-test validation for AI/LLM/agent-written code. Produces severity-ranked findings for weak assertions, oracle gaps, brittle fixtures, over-mocking, CI trust, and generated-code test risks.
metadata:
  version: "0.2.20"
  source_domain: software-test-suite-auditing
  source_sub_domains: "test-intent-traceability, risk-based-test-relevance, assertion-oracle-quality, independent-oracle-design, coverage-vs-effectiveness, mutation-testing-fault-detection, test-suite-architecture, test-data-fixtures, flakiness-determinism, ci-signal-quality, test-maintainability, escaped-defects-feedback, audit-workflow, llm-generated-test-validity, generated-test-antipatterns, llm-adversarial-validation, agentic-codebase-test-auditing, spec-drift-ai-built-systems"
  research_date: "2026-05-22"
---

# Codebase Test Suite Audit

## First Actions

Use repo evidence first. Run:

```bash
rg --files | rg '(^|/)(README|package.json|pyproject.toml|go.mod|Cargo.toml|pom.xml|build.gradle|vitest.config|jest.config|pytest.ini|tox.ini|.github/workflows)'
rg --files | rg '(^|/)(test|tests|spec|specs|__tests__|fixtures|mocks)(/|$)'
rg -n "coverage|mutation|stryker|mutmut|flake|retry|quarantine|snapshot|mock|sleep|TODO|generated|AI|LLM" .
```

Before findings, write a repo brief covering:

- Domain, stack, package manager, and test runner
- Test paths, naming conventions, and layers
- CI gates, coverage, mutation, quarantine, and flake handling
- Provided change, incident, issue, release, or generated-code context
- Missing evidence: CI history, coverage, mutation, defects, requirements

## Process

1. Write the repo brief.
2. Build an evidence table across core audit areas; use `Reviewed`, `Partial`,
   `Not Provided`, or `Not Applicable`.
3. Inspect representative tests and collect `path:line` evidence.
4. Check whether each sampled test has an independent oracle and would fail on
   a plausible bad implementation.
5. Cross-check every severity against the finding contract, shortcuts, and
   evidence table; fix overclaims before reporting.
6. Fill the report sections and remediation plan.

## Finding Contract

Every finding at every severity, including Low, must use this block:

```markdown
- Severity:
- Evidence checked: include `path:line` for local file evidence when available
- Impact:
- Affected tests or behavior:
- Recommended fix:
- Verification step:
```

Classification shortcuts:

| Signal | Required handling |
|---|---|
| Assertionless or copied oracle only | Not `Critical`; usually `Medium` |
| Weak fee, refund, charge, or total oracle on ledger path | `High`, including copied formulas |
| Type-only, non-null, truthy, or mocked-shape check on ledger path | `High` |
| Generated tests without build/run/repeat evidence | Do not trust |
| AI-built behavior not checked against intended semantics | Explicit spec-drift finding |
| Fixed sleep or timing assumption | Standalone flakiness finding |
| Shared mutable fixture or global state | Standalone order-dependence finding |
| Unseeded random fixture data | Standalone reproducibility finding |

Coverage percentage, green CI, TODOs, and aspirational docs are not proof of
fault detection. Do not claim mutation, coverage, CI, flake, requirement, or
production-defect evidence was reviewed when unavailable.

## Report Rules

All linked files are bundled under [references/](references/); load only the
named file needed for the current step.

Use [report-template.md](references/report-template.md). If a severity section
has no findings, keep the heading and write `None found from available
evidence`. Sequence remediation by risk, dependency, and verification value; do
not recommend broad rewrites before the highest-risk weak signal is isolated.
For AI-assisted codebases, make `LLM and Generated-Test Notes` compare intended
behavior against what generated tests actually validate.

Optional deep dives: [evidence-inventory.md](references/evidence-inventory.md)
for evidence statuses and sampling prompts, [audit-domains.md](references/audit-domains.md)
for domain checks, [guardrails-and-success.md](references/guardrails-and-success.md)
for severity guardrails.
