// Standalone harness for the full analysis pipeline. Run via:
//   npm run test:pipeline                                # defaults to vercel.com
//   npm run test:pipeline -- https://example.com
// Or directly:
//   npx tsx --env-file=.env.local scripts/test-pipeline.ts [url]
//
// Mirrors the per-specialist test scripts so we can smoke-test the synth +
// pipeline wiring without spinning up the Next.js server.

import { runAnalysis } from "@/lib/pipeline";
import { getVercelFeatureById } from "@/lib/vercel-features";

const DEFAULT_URL = "https://vercel.com/";

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  console.error(`→ analyzing ${url}`);
  const started = Date.now();

  // Manual harness — pass a longer PSI cap than the API route's 30s default.
  // PSI wall clock varies meaningfully on real sites; see fetchPsi's inline
  // comment on the manual/eval carve-out.
  const result = await runAnalysis(url, { psiTimeoutMs: 60_000 });
  console.error(`  pipeline finished in ${Date.now() - started}ms`);
  console.error(`  htmlBlocked=${result.htmlBlocked}`);
  if (result.degradedSpecialists.length > 0) {
    console.error(
      `  ⚠ degraded specialists: ${result.degradedSpecialists.join(", ")}`,
    );
  } else {
    console.error(`  ✓ all specialists completed`);
  }

  const allFindings = [
    ...(result.report.topPriority ? [result.report.topPriority] : []),
    ...result.report.findings,
  ];
  const integrity = allFindings.map((f) => ({
    id: f.id,
    vercelFeatureId: f.vercelFeatureId,
    resolved: Boolean(getVercelFeatureById(f.vercelFeatureId)),
  }));
  const unresolved = integrity.filter((i) => !i.resolved);
  if (unresolved.length > 0) {
    console.error(
      `  ⚠ ${unresolved.length} finding(s) reference features not in the catalog:`,
      unresolved,
    );
  } else {
    console.error(
      `  ✓ all ${result.report.findings.length} finding(s) map to catalog features`,
    );
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
