// Standalone harness for the CWV specialist. Run via:
//   npm run test:cwv                               # defaults to nytimes.com
//   npm run test:cwv -- https://example.com
// Or directly:
//   npx tsx --env-file=.env.local scripts/test-cwv-specialist.ts [url]

import { fetchPsi } from "@/lib/psi";
import { fetchHtml, parseHtmlForAssets, type ParsedAssets } from "@/lib/html";
import { extractCwvSlice } from "@/lib/data-slice";
import { runCwvSpecialist } from "@/lib/agents/cwv";
import { getVercelFeatureById } from "@/lib/vercel-features";

// NYTimes is the intended scope-boundary exercise: LCP is typically slow and
// image-driven here, so we want to see the specialist describe the image-lane
// attribution in prose WITHOUT emitting an image-category finding.
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

  const slice = extractCwvSlice(psi, htmlResult, assets);
  console.error(
    `  slice: ${Object.keys(slice.metrics).length} metrics, ${Object.keys(slice.diagnostics).length} diagnostics, ${slice.fontPreloads.length} font preloads, lcp=${slice.lcpElement ? "yes" : "no"}`,
  );

  const agentStart = Date.now();
  const output = await runCwvSpecialist(slice);
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

  // CWV scope-boundary check: every finding should be category "cwv" AND map
  // to one of the two CWV-subset features. If we see a bundle/image/cache
  // finding here, the specialist leaked out of its lane.
  const outOfLane = output.findings.filter(
    (f) =>
      f.category !== "cwv" ||
      !["font-optimization", "partial-prerendering"].includes(f.vercelFeatureId),
  );
  if (outOfLane.length > 0) {
    console.error(
      `  ⚠ ${outOfLane.length} finding(s) violate the CWV scope boundary:`,
      outOfLane.map((f) => ({
        id: f.id,
        category: f.category,
        vercelFeatureId: f.vercelFeatureId,
      })),
    );
  } else {
    console.error(`  ✓ all findings stay within the CWV scope boundary`);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
