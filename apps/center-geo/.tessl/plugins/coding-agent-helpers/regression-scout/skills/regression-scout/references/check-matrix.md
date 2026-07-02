# Regression Scout — Check Matrix

Pull this file when you already know the change surface and want a fuller menu of regression checks than the SKILL.md body carries.

## Choose checks by change class

### 1. CLI / stdout / stderr / report-shape changes

Run at least 3 of these:

- built artifact invocation (not only unit tests)
- machine parse of stdout (JSON/YAML/CSV parser, schema validator, snapshot reader)
- stderr-only commentary check when stdout is meant for machines
- exit-code check on success and threshold/error paths
- file-emission check when the CLI writes reports or side effects

### 2. Config / validation / defaulting changes

Run at least 3 of these:

- valid config still loads and behaves as expected
- invalid config fails loudly and specifically
- omitted optional fields still pick up intended defaults
- old config shape or minimal config still works if backwards compatibility matters
- error messages still point at the offending field/path

### 3. Parser / adapter / identifier-mapping changes

Run at least 3 of these:

- intended mapping path proves the fix
- sibling path that shares the same mapper or ID scheme still resolves
- degraded path (missing target, dynamic target, unknown target) fails honestly
- downstream reader or consumer still recognizes the emitted identifiers

### 4. Engine / pipeline / scoring changes

Run at least 3 of these:

- direct scenario that produces the intended signal
- adjacent engine or geometry path that shares downstream code
- report or snapshot generation after the new signal lands
- diff / compare / downstream aggregation still parses the emitted shape
- severity/score ordering still behaves on the modified path

### 5. Build / packaged / generated-output changes

Run at least 3 of these:

- build passes from a clean state
- packaged or built artifact actually runs
- generated output files exist where callers expect them
- source-vs-built parity on one real scenario
- artifact-only regression path (compiled output, copied assets, emitted metadata)

## Reporting reminder

For each chosen check, record:

- what you exercised
- whether it was `pass`, `fail`, `concern`, or `N/A`
- the consumer or surface protected by that check

If the check only proves the main feature still works, it does not count toward the adjacent-regression budget unless it also covers a sibling surface.
