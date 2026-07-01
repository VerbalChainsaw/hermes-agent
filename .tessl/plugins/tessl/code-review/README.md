# tessleng/code-review

A suite of focused code-review skills for use from Tessl Agent and GitHub
Actions review workflows via `tessl change review`. Each review lens is its own
skill, so a workflow can point at exactly the lenses it wants instead of
activating all of them.

This plugin is private for now. It is designed to be easy to fork: copy a skill
into your own repository and tune its triggers, anti-patterns, and examples for
your codebase.

## Skills

- **review-security-risks** — OWASP-inspired security lens: auth/authz,
  untrusted input, injection, output encoding, secrets, crypto, sensitive
  logging, file and network access, webhooks, and dependency or build-script
  changes. Complements scanners (CodeQL, Snyk, Dependabot) rather than
  duplicating them.
- **review-code-legibility** — whether a reader with no prior context can
  understand each name, type, return shape, file, and abstraction from what's in
  front of them, via the cold-reader and from-scratch tests.
- **review-local-precedent** — whether new code should have reused an existing
  helper, component, schema, route shape, fixture, or convention, under a strict
  bounded search budget that never scans the whole repository.
- **review-test-risk** — changed behaviour without meaningful tests, bug fixes
  without a regression test, uncovered async/error/edge branches, and brittle
  tests that assert implementation trivia.
- **review-contract-boundaries** — API schemas, generated clients, CLI flags,
  event payloads, database migrations, workflow/job contracts, and backwards
  compatibility risks.

## Invoking individual skills

`tessl change review` takes one or more `--skill` references. A reference can be
a local path (a `SKILL.md` file or a skill directory), an installed skill name,
or a registry ref `workspace/plugin[@version]#skill`. Pass only the lenses you
want — skills are not auto-discovered.

Run a single lens against the current diff (local path):

```bash
tessl change review \
  --skill apps/cli/plugins/code-review/skills/review-security-risks
```

Run two lenses together:

```bash
tessl change review \
  --skill apps/cli/plugins/code-review/skills/review-security-risks \
  --skill apps/cli/plugins/code-review/skills/review-test-risk
```

Once the plugin is installed, reference a skill by registry ref:

```bash
tessl change review --skill tessleng/code-review#review-contract-boundaries
```

## Using from GitHub Actions

`tessl change review` only emits structured review data; a GitHub caller posts
it as an overall review plus inline comments. In a workflow step, select the
lenses relevant to the changed paths and write the result to a file:

```bash
tessl change review \
  --skill tessleng/code-review#review-security-risks \
  --skill tessleng/code-review#review-contract-boundaries \
  --base origin/main \
  --json --output review.json
```

Then post `review.json` from a later step. Because each lens is a separate
`--skill`, a workflow can choose lenses per changed path — for example, run
`review-contract-boundaries` only when an API schema or migration changed.

## Writing a new lens

Add `skills/<name>/SKILL.md` with `name` and `description` frontmatter, a short
single-screen body stating the review stance, what to look for, and how to
report. Keep findings high-confidence and file-anchored, review the diff first,
avoid broad repository archaeology, and prefer concrete findings over generic
advice — say so explicitly when no issues are found.
