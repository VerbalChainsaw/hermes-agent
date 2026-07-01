# Guardrails and Success

Do not treat green tests, coverage, TODOs, or aspirational docs as proof of
regression protection. Do not modify tests, fixtures, CI, or source code during
an audit unless explicitly asked.

Severity guide:

| Severity | Use when |
|---|---|
| Critical | Missing safety/security/compliance/data-loss behavior, untrusted CI gates, or generated tests validating wrong high-risk behavior |
| High | Weak oracles on critical paths, no major boundary tests, financial weak assertions, widespread flaky gates, or generated tests accepted without execution evidence |
| Medium | Over-mocking, brittle fixtures, poor traceability, missing mutation/negative controls, incomplete CI ownership, or direct flakiness signals |
| Low | Naming, organization, helper clarity, documentation, or lower-risk maintainability |

Success requires severity-ranked findings, concrete file evidence, verification
steps, risk-ordered remediation, and explicit open evidence gaps.
