# Audit Domains

- Trace tests to behavior, requirements, incidents, contracts, or risks.
- Compare high-impact paths with test attention.
- Treat coverage as a locator, not proof of fault detection.
- Prefer independent oracles: specs, reference data, contracts, examples,
  metamorphic relations, or human-reviewed expected results.
- Inspect fixture realism, isolation, privacy, and stale golden data.
- Look for sleeps, retries, quarantine, order dependence, randomness, shared
  stores, clocks, network reliance, and async races.
- Check CI ownership, required checks, runtime, failure clarity, and rerun
  habits.
- For generated tests, require build/run/repeat evidence and check for
  hallucinated APIs, copied implementation logic, and spec drift.
