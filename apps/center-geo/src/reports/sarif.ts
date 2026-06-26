/**
 * SARIF report writer (T19).
 *
 * Writes a SARIF 2.1.0 report for integration with GitHub code scanning
 * and other SARIF consumers. SARIF is a JSON-based static analysis
 * result interchange format; see https://docs.oasis-open.org/sarif/
 * sarif/v2.1.0/sarif-v2.1.0.html for the full spec.
 *
 * We emit the minimum SARIF 2.1.0 shape required for GitHub ingestion:
 *   - `runs[].tool.driver`: name + version + rules
 *   - `runs[].results[]`: one per FusedScore (top-N), with ruleId,
 *     level, message, and locations.
 *
 * Each FusedScore maps to one SARIF result. Severity hints map to
 * SARIF levels: info/low/medium/high/critical.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FusedScore } from "../scoring/types.js";
import type { SeverityHint } from "../engines/radial/signals.js";

/** SARIF 2.1.0 level (the `level` field on a result). */
type SarifLevel = "none" | "note" | "warning" | "error";

/** Map our SeverityHint to SARIF's smaller level vocabulary. */
function severityToSarifLevel(sev: SeverityHint): SarifLevel {
  switch (sev) {
    case "info":
      return "note";
    case "low":
    case "medium":
      return "warning";
    case "high":
    case "critical":
      return "error";
  }
}

/** SARIF 2.1.0 result location (union of physicalLocation + logicalLocation). */
type SarifLocation =
  | {
      physicalLocation: {
        artifactLocation: { uri: string };
        region?: { startLine?: number; endLine?: number };
      };
    }
  | { logicalLocation: { name: string } };

/** SARIF 2.1.0 result object (subset). */
interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  properties: {
    score: number;
    geometries: string[];
    edgeKinds: string[];
    signalCount: number;
  };
}

/** SARIF 2.1.0 reporting descriptor (subset). */
interface SarifReport {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
          fullDescription?: { text: string };
          defaultConfiguration?: { level: SarifLevel };
        }>;
      };
    };
    results: SarifResult[];
  }>;
}

const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";

/**
 * Convert FusedScore[] to a SARIF 2.1.0 report. Pure transformation;
 * does not write to disk.
 */
export function toSarif(
  fused: readonly FusedScore[],
  topN: number,
  toolName: string,
  toolVersion: string,
): SarifReport {
  const top = fused.slice(0, topN);

  // One rule per distinct (geometry × signal_type) combo across the
  // top hypotheses. SARIF rules are deduplicated by id; emitting each
  // unique combo as a rule makes the report navigable.
  const ruleMap = new Map<string, { geometries: string[]; signalType: string }>();
  for (const h of top) {
    for (const c of h.contributors) {
      const ruleId = `${c.geometryId}/${c.type}`;
      if (!ruleMap.has(ruleId)) {
        ruleMap.set(ruleId, { geometries: [c.geometryId], signalType: c.type });
      }
    }
  }

  const rules = [...ruleMap.entries()].map(([id, info]) => {
    const worstSeverity = top
      .filter((h) => h.contributors.some((c) => `${c.geometryId}/${c.type}` === id))
      .reduce<SeverityHint>(
        (acc, h) => {
          const order: Record<SeverityHint, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
          return order[h.maxSeverity] > order[acc] ? h.maxSeverity : acc;
        },
        "info",
      );
    return {
      id,
      name: info.signalType,
      shortDescription: { text: `${info.signalType} (${info.geometries.join(", ")})` },
      defaultConfiguration: { level: severityToSarifLevel(worstSeverity) },
    };
  });

  const results: SarifResult[] = top.map((h) => {
    const locs: SarifLocation[] = h.contributors[0]?.anchors
      .filter((a) => a.path && a.path !== "<unknown>")
      .map((a) => ({
        physicalLocation: {
          artifactLocation: { uri: a.path },
          region: a.range?.start_line
            ? {
                startLine: a.range.start_line,
                endLine: a.range.end_line,
              }
            : undefined,
        },
      })) ?? [];
    // Fallback: at least one location pointing at the target id, no
    // physical file. SARIF allows logicalLocation for this case.
    if (locs.length === 0) {
      locs.push({ logicalLocation: { name: h.targetId } });
    }
    const ruleId =
      h.contributors[0]
        ? `${h.contributors[0].geometryId}/${h.contributors[0].type}`
        : "center-geo/unknown";
    return {
      ruleId,
      level: severityToSarifLevel(h.maxSeverity),
      message: {
        text: `Fused score ${h.score.toFixed(2)} from ${h.contributors.length} signal(s) across ${h.geometries.length} geometries.`,
      },
      locations: locs,
      properties: {
        score: h.score,
        geometries: h.geometries,
        edgeKinds: h.edgeKinds,
        signalCount: h.contributors.length,
      },
    };
  });

  return {
    $schema: SARIF_SCHEMA_URL,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            informationUri: "https://github.com/center-geo",
            rules,
          },
        },
        results,
      },
    ],
  };
}

/**
 * Write the SARIF report to `outputPath`. The directory is created
 * if it does not exist.
 */
export async function writeSarifReport(
  fused: readonly FusedScore[],
  topN: number,
  toolName: string,
  toolVersion: string,
  outputPath: string,
): Promise<void> {
  const report = toSarif(fused, topN, toolName, toolVersion);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}