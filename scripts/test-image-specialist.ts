// Standalone harness for the image specialist. Run via:
//   npm run test:image                              # defaults to nytimes.com
//   npm run test:image -- https://example.com
// Or directly:
//   npx tsx --env-file=.env.local scripts/test-image-specialist.ts [url]
//
// Not part of the eval harness — that lives at scripts/eval.ts (Day 3).

import { fetchPsi } from "@/lib/psi";
import { fetchHtml, parseHtmlForAssets, type ParsedAssets } from "@/lib/html";
import { extractImageSlice } from "@/lib/data-slice";
import { runImageSpecialist } from "@/lib/agents/image";
import { getVercelFeatureById } from "@/lib/vercel-features";

const DEFAULT_URL = "https://www.nytimes.com/";

const EMPTY_ASSETS: ParsedAssets = {
  images: [],
  scripts: [],
  preloads: [],
  stylesheets: [],
  title: null,
};

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  console.error(`→ analyzing ${url}`);
  const started = Date.now();

  // PSI's run time is nondeterministic — bump the cap for manual runs. The
  // production API route uses the tighter 30s default to fail fast.
  const [psi, htmlResult] = await Promise.all([
    fetchPsi(url, { timeoutMs: 90_000 }),
    fetchHtml(url),
  ]);
  console.error(
    `  PSI+HTML fetched in ${Date.now() - started}ms (htmlBlocked=${htmlResult.blocked})`,
  );

  const assets = htmlResult.html
    ? parseHtmlForAssets(htmlResult.html)
    : EMPTY_ASSETS;

  const slice = extractImageSlice(psi, htmlResult, assets);
  console.error(
    `  slice: ${Object.keys(slice.audits).length} audits, ${slice.totalImagesOnPage} images, lcp=${slice.lcpElement ? "yes" : "no"}`,
  );

  const agentStart = Date.now();
  const output = await runImageSpecialist(slice);
  console.error(`  agent finished in ${Date.now() - agentStart}ms`);

  // Quick integrity sanity-check before we print the full JSON. Not a full
  // eval — just the catalog-grounding invariant.
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

  // Full structured output on stdout — pipe through | jq for inspection.
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
