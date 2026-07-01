# Codebase Test Suite Audit

Use this skill to audit automated tests for relevance, validity, assertion and
oracle strength, risk coverage, maintainability, CI signal quality, flakiness,
fixture realism, and LLM-generated or agent-built codebase risks.

The skill is audit-first. It helps an agent inspect repo evidence, build a test
system map, classify findings by severity, and produce a concrete remediation
plan without rewriting tests unless the user explicitly asks for implementation.

## When to Use

- Test suite audits, test reviews, QA reviews, and test relevance reviews
- Questions about whether tests are meaningful, brittle, flaky, shallow, or
  over-mocked
- Reviews of generated tests, LLM-written tests, or agent-built codebases
- Release, migration, refactor, or generated-code trust decisions

## Install

```bash
tessl install sharaf/codebase-test-suite-audit
```

## Organization

| Path | Purpose |
|---|---|
| `skills/codebase-test-suite-audit/SKILL.md` | Main workflow, evidence rules, and finding contract |
| `skills/codebase-test-suite-audit/references/report-template.md` | Required report headings |
| `skills/codebase-test-suite-audit/references/evidence-inventory.md` | Evidence statuses and sampling prompts |
| `skills/codebase-test-suite-audit/references/audit-domains.md` | Domain-specific audit checks |
| `skills/codebase-test-suite-audit/references/guardrails-and-success.md` | Severity guardrails and completion checks |
| `tile.json` | Tessl tile manifest and registry summary |
| `README.md` | Registry-facing overview |

## Output Shape

The default deliverable is a test suite audit report with:

- Executive summary
- Evidence reviewed and open evidence gaps
- Test system map
- Findings ordered by severity
- Domain-by-domain assessment
- LLM and generated-test notes
- CI signal, flakiness, coverage, mutation, and oracle notes
- Prioritized remediation plan with verification steps

## Eval Results

Tested on May 22, 2026 across three scenarios:

| Scenario | Baseline | With skill |
|---|---:|---:|
| Weak oracle and assertionless test detection | 53% | 100% |
| LLM-generated test validity and spec drift audit | 94% | 100% |
| Flaky CI signal and fixture realism audit | 82% | 100% |
| Average | 76% | 100% |

Activation: 3/3 scenarios naturally fired
`tessl__codebase-test-suite-audit`.

Single-scenario multi-model spot check:

| Model | Baseline | With skill |
|---|---:|---:|
| `claude-haiku-4-5` | 62% | 99% |
| `claude-sonnet-4-6` | 58% | 100% |
| `claude-opus-4-6` | 61% | 100% |
