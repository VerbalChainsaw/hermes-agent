# CENTER-MULTIGEOMETRY Report

Schema version: 1.0.0
Tool version: 0.1.0
Raw signals: 9
Fused hypotheses: 8
Top N shown: 8

## Top hypotheses by fused score

| Rank | Score | Severity | Target | Geometries |
| ---- | ----- | -------- | ------ | ---------- |
| 1 | 1.25 | high | `file:b37fc6133ea25705` | anomaly, radial |
| 2 | 0.00 | low | `file:0f54371f19fd5a12` | anomaly |
| 3 | 0.00 | low | `file:106dd9949759b4c6` | anomaly |
| 4 | 0.00 | low | `file:39250c1ce7a64716` | anomaly |
| 5 | 0.00 | low | `file:79c9bc7180e0dd77` | anomaly |
| 6 | 0.00 | low | `file:95162c5c019186e0` | anomaly |
| 7 | 0.00 | low | `file:a98805ce14972512` | anomaly |
| 8 | 0.00 | low | `file:be335e4e2e96bea0` | anomaly |

## Limitations

- Signals are HYPOTHESES, not defects (per docs/01 §G4).
- Severity scale is heuristic; not calibrated against historical defect rates.
- Static analysis only — runtime metrics are not measured.
- Fusion formula weights are configurable; results depend on `config.scoring`.
