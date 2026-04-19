// Standalone harness for the cache specialist. Run via:
//   npm run test:cache                                # defaults to vercel.com
//   npm run test:cache -- https://example.com
// Or directly:
//   npx tsx --env-file=.env.local scripts/test-cache-specialist.ts [url]

import { fetchPsi } from "@/lib/psi";
import { fetchHtml } from "@/lib/html";
import { extractCacheSlice } from "@/lib/data-slice";
import { runCacheSpecialist, buildPrompt } from "@/lib/agents/cache";
import { getVercelFeatureById } from "@/lib/vercel-features";

const DEFAULT_URL = "https://vercel.com/";

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  console.error(`→ analyzing ${url}`);
  const started = Date.now();

  const [psi, htmlResult] = await Promise.all([
    fetchPsi(url, { timeoutMs: 90_000 }),
    fetchHtml(url),
  ]);
  console.error(
    `  PSI+HTML fetched in ${Date.now() - started}ms (htmlBlocked=${htmlResult.blocked})`,
  );

  const slice = extractCacheSlice(psi, htmlResult);
  console.error(
    `  slice: ${Object.keys(slice.audits).length} audits, cdn=${slice.cdn.provider}, headers=${Object.keys(slice.originHeaders).length}`,
  );

  console.error("\n========== PROMPT SENT TO HAIKU (findings call) ==========");
  console.error(buildPrompt(slice));
  console.error("========== END PROMPT ==========\n");

  const agentStart = Date.now();
  const output = await runCacheSpecialist(slice);
  console.error(`  agent finished in ${Date.now() - agentStart}ms`);

  const integrity = output.findings.map((f) => ({
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
      `  ✓ all ${output.findings.length} finding(s) map to catalog features`,
    );
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
