import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, hashConfig } from "../src/config/index.js";
import { runScanPipeline } from "../src/scan/pipeline.js";
import { createFixture } from "./fixtures/synthetic.js";

describe("runScanPipeline — graph snapshot contract", () => {
  it("builds a store snapshot with revision object, config hash, and spec coverage fields", async () => {
    const fixture = await createFixture("small");
    try {
      const result = await runScanPipeline({
        repo: fixture.root,
        config: DEFAULT_CONFIG,
      });
      const snapshot = result.store.snapshot as any;
      expect(snapshot.schema_version).toBe("1.0.0");
      expect(snapshot.root).toBe(fixture.root);
      expect(snapshot.config_hash).toBe(hashConfig(DEFAULT_CONFIG));
      expect(snapshot.revision).toBeDefined();
      expect(typeof snapshot.revision).toBe("object");
      expect(typeof snapshot.revision.vcs).toBe("string");
      expect(typeof snapshot.revision.snapshot_hash).toBe("string");
      expect(snapshot.coverage.files_seen).toBe(fixture.fileCount);
      expect(snapshot.coverage.files_indexed).toBe(fixture.fileCount);
      expect(snapshot.coverage.files_skipped).toBe(0);
      expect(snapshot.coverage.files_failed).toBe(0);
      expect(snapshot.coverage.nodes_total).toBe(result.nodes.length);
      expect(snapshot.coverage.edges_total).toBe(result.edges.length);
      expect(snapshot.coverage.generated_files).toBe(0);
      expect(snapshot.coverage.unsupported_files).toBe(0);
      expect(snapshot.coverage.parse_failure_paths).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
});
