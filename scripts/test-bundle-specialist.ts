// Standalone harness for the bundle specialist. Run via:
//   npm run test:bundle                                # defaults to cnn.com
//   npm run test:bundle -- https://example.com
// Or directly:
//   npx tsx --env-file=.env.local scripts/test-bundle-specialist.ts [url]

import { fetchPsi } from "@/lib/psi";
import { fetchHtml, parseHtmlForAssets, type ParsedAssets } from "@/lib/html";
import { extractBundleSlice } from "@/lib/data-slice";
import { runBundleSpecialist, buildPrompt } from "@/lib/agents/bundle";
import { getVercelFeatureById } from "@/lib/vercel-features";

const DEFAULT_URL = "https://www.cnn.com/";

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

  const slice = extractBundleSlice(psi, htmlResult, assets);
  console.error(
    `  slice: ${Object.keys(slice.audits).length} audits, ${slice.totalScripts} scripts (${slice.thirdPartyScripts.length} 3p)`,
  );

  const thirdPartySample = slice.thirdPartyScripts.slice(0, 5).map((s) => ({
    src: s.src,
    async: s.async,
    defer: s.defer,
    type: s.type,
    nextScriptStrategy: s.nextScriptStrategy,
  }));
  console.error(
    `  thirdPartyScripts sample (first ${thirdPartySample.length} of ${slice.thirdPartyScripts.length}):`,
  );
  console.error(JSON.stringify(thirdPartySample, null, 2));

  console.error("\n========== PROMPT SENT TO HAIKU (findings call) ==========");
  console.error(buildPrompt(slice));
  console.error("========== END PROMPT ==========\n");

  const agentStart = Date.now();
  const output = await runBundleSpecialist(slice);
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
