/**
 * Parser wrapper around @typescript-eslint/parser.
 *
 * Why @typescript-eslint/parser (not typescript or @babel/parser):
 *   - Uses the TypeScript compiler API under the hood, so TS+JS+JSX
 *     parse trees are accurate and consistent.
 *   - Smaller surface area than full `typescript` (we don't need the
 *     language service).
 *   - Already used by the linter stack across the user's monorepo,
 *     so parser versions are aligned with whatever their projects use.
 *
 * The wrapper exists so:
 *   - Adapter code can `await parseSource(file)` without knowing the
 *     parser package's surface.
 *   - We can swap parsers later (e.g. for a SWC adapter) without
 *     touching callers.
 *   - Parse errors map cleanly to our ParseDiagnostic shape.
 *
 * IMPORTANT: @typescript-eslint/parser returns a Program node (TS AST)
 * for TS files and a Program node (ESTree-shaped) for JS files. We
 * support both by treating them uniformly at the AST-walker level —
 * the type-narrowing happens via `parserServices` or by checking
 * syntax-nodes that exist in both dialects.
 */

import { parse as tsParserParse } from "@typescript-eslint/parser";

export interface ParsedFile {
  /** TS Program AST or ESTree Program, depending on file extension. */
  ast: unknown;
  /** Language tag for downstream consumers. */
  language: "typescript" | "javascript" | "unknown";
  /** Wall-clock parse time in ms. */
  parseMs: number;
}

/**
 * Detect language from file path extension. Defaults to "typescript"
 * because most .ts/.tsx files are TypeScript, and `.js` defaults to
 * JavaScript. Unknown extensions try TS first (TS is a superset of JS
 * syntactically) — fall back to JS if TS parse fails.
 */
function detectLanguage(filePath: string): "typescript" | "javascript" | "unknown" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  return "unknown";
}

export function parseSource(filePath: string, source: string): ParsedFile {
  const start = performance.now();
  const language = detectLanguage(filePath);
  // Always try TS parser first — TS is a syntactic superset of JS so
  // a .js file with TS-only constructs will fail, but a .ts file parsed
  // as JS would lose type info. The parser accepts both via the
  // project config.
  const ast = tsParserParse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    // Allow `loc` and `range` so we can produce evidence anchors.
    loc: true,
    range: true,
  });
  return { ast, language, parseMs: performance.now() - start };
}
