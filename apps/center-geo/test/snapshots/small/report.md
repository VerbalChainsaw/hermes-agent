# CENTER-MULTIGEOMETRY Report

These are structural risk hypotheses derived from graph evidence. They are not confirmed defects until reproduced or proven by a focused audit.

## Executive summary

- Files indexed: 10
- Parse failures: 0
- Engines run: radial, cycle, boundary, anomaly, convergent, path
- Highest hypothesis severity: high

## Scan frame

- Mode: scan
- Root: current scan target (exact path is carried in JSON output)
- Graph id: scan:0d3f59b55bdbb820
- Config hash: 7b842043d5a663b1
- Revision: snapshot 0d3f59b55bdbb820

## Coverage and extraction gaps

- Files seen: 10
- Files indexed: 10
- Files skipped: 0
- Files failed: 0
- Nodes total: 20
- Edges total: 29
- Extraction gaps: none recorded

## Top hypotheses

### H001 - node file:b37fc6133ea25705 surfaced across 2 geometries

Status: hypothesis
Severity hint: high
Confidence: medium
Contributing geometries: anomaly, radial

Why this surfaced:

- 2 geometries contributed evidence.
- 2 independent edge-kind buckets contributed.
- Highest contributor severity: high.

Evidence anchors:

- src/f9.ts:1-12
- src/f9.ts:1-12

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- does not weight edges by confidence; counts allowed-kind edges only
- false positives expected on purpose-built hubs (barrel files, index.ts)
- filtered fan-out threshold (8) is a placeholder; T12+ replaces with config-driven percentile
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:b37fc6133ea25705
- Suspected invariant: The system should not require node file:b37fc6133ea25705 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:b37fc6133ea25705?

### H002 - node file:0f54371f19fd5a12 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f2.ts:1-4

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:0f54371f19fd5a12
- Suspected invariant: The system should not require node file:0f54371f19fd5a12 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:0f54371f19fd5a12?

### H003 - node file:106dd9949759b4c6 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f4.ts:1-4

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:106dd9949759b4c6
- Suspected invariant: The system should not require node file:106dd9949759b4c6 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:106dd9949759b4c6?

### H004 - node file:39250c1ce7a64716 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f7.ts:1-4

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:39250c1ce7a64716
- Suspected invariant: The system should not require node file:39250c1ce7a64716 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:39250c1ce7a64716?

### H005 - node file:79c9bc7180e0dd77 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f8.ts:1-5

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:79c9bc7180e0dd77
- Suspected invariant: The system should not require node file:79c9bc7180e0dd77 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:79c9bc7180e0dd77?

### H006 - node file:95162c5c019186e0 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f5.ts:1-5

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:95162c5c019186e0
- Suspected invariant: The system should not require node file:95162c5c019186e0 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:95162c5c019186e0?

### H007 - node file:a98805ce14972512 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f1.ts:1-4

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:a98805ce14972512
- Suspected invariant: The system should not require node file:a98805ce14972512 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:a98805ce14972512?

### H008 - node file:be335e4e2e96bea0 surfaced in anomaly

Status: hypothesis
Severity hint: low
Confidence: medium
Contributing geometries: anomaly

Why this surfaced:

- Single geometry contribution only.
- Highest contributor severity: low.

Evidence anchors:

- src/f0.ts:1-5

Limitations:

- Hypotheses are ranking aids, not confirmed defects.
- false positives expected on purpose-built hubs (barrel files, index.ts)
- severity scale is heuristic; not calibrated against historical defect rates
- single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual
- static analysis only — runtime metrics (call frequency, response time) are not measured

Suggested CENTER-AUDIT seed:

- Center: file:be335e4e2e96bea0
- Suspected invariant: The system should not require node file:be335e4e2e96bea0 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:be335e4e2e96bea0?

## Geometry summaries

- radial: completed (1 signals)
- cycle: completed (0 signals)
- boundary: completed (0 signals)
- anomaly: completed (8 signals)
- convergent: completed (0 signals)
- path: completed (0 signals)

## Boundary findings

None.

## Cycle findings

None.

## Anomaly-only leads

- node file:0f54371f19fd5a12 surfaced in anomaly
- node file:106dd9949759b4c6 surfaced in anomaly
- node file:39250c1ce7a64716 surfaced in anomaly
- node file:79c9bc7180e0dd77 surfaced in anomaly
- node file:95162c5c019186e0 surfaced in anomaly
- node file:a98805ce14972512 surfaced in anomaly
- node file:be335e4e2e96bea0 surfaced in anomaly

## Convergent dependencies

None.

## Agent investigation packets

### Packet H001

- Objective: Verify whether node file:b37fc6133ea25705 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:b37fc6133ea25705 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:b37fc6133ea25705?

### Packet H002

- Objective: Verify whether node file:0f54371f19fd5a12 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:0f54371f19fd5a12 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:0f54371f19fd5a12?

### Packet H003

- Objective: Verify whether node file:106dd9949759b4c6 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:106dd9949759b4c6 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:106dd9949759b4c6?

### Packet H004

- Objective: Verify whether node file:39250c1ce7a64716 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:39250c1ce7a64716 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:39250c1ce7a64716?

### Packet H005

- Objective: Verify whether node file:79c9bc7180e0dd77 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:79c9bc7180e0dd77 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:79c9bc7180e0dd77?

### Packet H006

- Objective: Verify whether node file:95162c5c019186e0 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:95162c5c019186e0 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:95162c5c019186e0?

### Packet H007

- Objective: Verify whether node file:a98805ce14972512 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:a98805ce14972512 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:a98805ce14972512?

### Packet H008

- Objective: Verify whether node file:be335e4e2e96bea0 represents a real architectural or behavioral defect.
- Suspected invariant: The system should not require node file:be335e4e2e96bea0 to carry this level of multi-geometry structural risk.
- First question: Which contributor produced the highest-severity evidence for file:be335e4e2e96bea0?

## Non-goals and limitations

- CENTER-MULTIGEOMETRY ranks investigation targets; it does not confirm defects.
- Static graph extraction cannot see runtime-only behavior, dynamic dispatch resolution, or environment-specific wiring unless another tool verifies it.
- Report shape is deterministic; interpretation still requires human judgment or a focused audit.

## Appendix: config hash and engine versions

- Tool version: 0.1.0
- Config hash: 7b842043d5a663b1
- Engine statuses: radial=completed, cycle=completed, boundary=completed, anomaly=completed, convergent=completed, path=completed
