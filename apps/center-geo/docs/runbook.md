# Release Runbook (T25)

Pre-release verification steps for `@hermes/center-geo`.

## Pre-merge verification

1. **Tests pass:** `npm test` → 347/347 green.
2. **Build is clean:** `npm run build` → `tsc -b` exits 0.
3. **Real-CLI smoke:** `node dist/cli/main.js scan --output-dir /tmp/cg ./` → 0 errors, all 3 report files written.
4. **T25 path smoke:** run the built-artifact proof from `test/cli.test.ts` (symbol-tagged entry/sink fixture) or reproduce it manually with `node dist/cli/main.js scan --format json --config <temp-config.yaml> <temp-repo>` and confirm at least one hypothesis includes `"path"` in `geometries`.
5. **FR10 exit codes:** `node dist/cli/main.js --help` (0), `--version` (0), `bogus` (5), `--nope` (3), `scan /no/such/path` (4).
5. **Golden snapshots match:** `npm test` runs `test/snapshots.test.ts` which compares the small fixture's report.{json,md,sarif} to the checked-in goldens.

## Snapshot regeneration

If you intentionally change the report format:

```bash
rm -rf apps/center-geo/test/snapshots/small
# Re-run the test to capture the new golden
cd apps/center-geo && npm test -- snapshots
# Verify the new golden looks right
cat test/snapshots/small/report.json | head -10
git add apps/center-geo/test/snapshots/small
git commit -m "chore(apps/center-geo): regenerate snapshot goldens for <reason>"
```

## Tag-and-release procedure

```bash
# 1. Make sure you're on main, clean working tree.
git checkout main && git status

# 2. Confirm all tests + build pass on the final commit.
cd apps/center-geo && npm test && npm run build
cd ../..

# 3. Bump the version in package.json (the package is at v0.1.0;
#    for the first full release, bump to v1.0.0).
# 4. Commit the version bump.
git add apps/center-geo/package.json
git commit -m "chore(apps/center-geo): bump to v1.0.0"

# 5. Tag the release.
git tag -a v1.0.0 -m "center-geo v1.0.0 — first full release"
git push origin main --tags

# 6. Generate release notes.
gh release create v1.0.0 \
  --title "center-geo v1.0.0" \
  --notes-file RELEASE_NOTES.md
```

## Acceptance criteria (T28)

The package is "acceptably shipped" when ALL of the following hold:

- [ ] `npm test` exits 0 with 347/347 (or more) tests passing.
- [ ] `npm run build` exits 0.
- [ ] `node dist/cli/main.js scan --output-dir /tmp/cg-out ./` exits 0 or 1, and `/tmp/cg-out/` has `report.json` + `report.md` + `report.sarif`.
- [ ] A symbol-tagged temp fixture can produce at least one `path` geometry from the built CLI (`test/cli.test.ts` is the checked-in proof).
- [ ] `test/snapshots.test.ts` passes (golden files match the new output).
- [ ] `node dist/cli/main.js diff a.json b.json` produces a parseable JSON diff.
- [ ] All 5 FR10 exit codes produce the expected status.
- [ ] `docs/ci-integration.md` exists and the sample workflow runs on a test repo.

When all checkboxes are green, the package is "shipped."
