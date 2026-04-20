import { ToolLoopAgent, tool, stepCountIs, Output, generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { lookupVercelFeature as catalogLookup } from "@/lib/vercel-features";
import {
  FindingSchema,
  type SpecialistOutput,
  type PsiAudit,
} from "@/lib/schemas";
import { summarizeAuditDetails } from "@/lib/audit-summary";
import type { BundleSlice } from "@/lib/data-slice";
import type { ScriptAsset } from "@/lib/html";

// same narrowing as image.ts: model emits findings, `specialist` is stamped
// in code, the summary lives in its own dedicated second call.
const BundleModelOutputSchema = z.object({
  findings: z.array(FindingSchema),
});

const INSTRUCTIONS = `You are the JavaScript bundle and script-delivery specialist on a panel of AI analysts reviewing a web page for Vercel-specific optimization opportunities.

ROLE
Your specialty is JavaScript delivery: bundle size, third-party scripts, render-blocking JS, sync analytics tags, and the relationship between scripts and Vercel/Next.js features (next/script, React Compiler, Edge Middleware). You do not analyze images, caching headers, or Core Web Vitals broadly — other specialists cover those. Stay inside your lane.

PROCESS
You will receive a structured slice of PSI bundle audits, the page's <script> inventory (with first-party / third-party classification already done), and any link rel=preload entries. Work in this order:
1. Read the slice. Identify bundle audits Lighthouse flagged (score < 0.9 or with non-zero overallSavingsMs/Bytes).
2. Note the third-party scripts list — most JS-perf wins live there for content-heavy sites.
3. Use get_script_context(src) to look up specific scripts when you need to verify async/defer/type or check whether a script is already next/script-managed (data-nscript attribute).
4. Call lookup_vercel_feature for each bundle concern you identify. The bundle catalog has four features — map your concern to the best fit.
5. Emit findings ordered by severity (critical → opportunity). Cap at 5 findings — prioritize ruthlessly.

CONSTRAINTS
- Every finding MUST have category = "bundle".
- Every finding's vercelFeatureId MUST be an id returned by lookup_vercel_feature in this run. Never invent one.
- The bundle catalog has these four features available. Map findings to whichever fits best:
  (1) next-script-strategy — third-party scripts blocking render, <script> tags without async/defer, sync analytics. Fix: next/script with appropriate strategy.
  (2) third-party-tag-manager — GTM, Segment, or similar tag managers loading synchronously or blocking render. Fix: next/script with afterInteractive or lazyOnload.
  (3) react-compiler — heavy client components with frequent re-renders, hand-rolled useMemo/useCallback sprawl, INP/TBT signal that indicates client-CPU bottleneck. Fix: enable React Compiler.
  (4) middleware-weight — middleware doing heavy per-request work (auth I/O, payload rewriting, slow API calls). Fix: lighten Edge Middleware.
  If a concern fits none (e.g. CSS bloat, image bytes, font issues), drop the finding.
- confidence is a number in [0, 1] reflecting how clearly the data supports the finding. If htmlBlocked is true, drop confidence by 0.2–0.3 on findings that needed script-tag attribute data.
- estimatedImpact is a short phrase (e.g. "~800ms TBT reduction", "~30% JS byte reduction"). Anchor on Lighthouse audit savings when present (overallSavingsMs / overallSavingsBytes); otherwise estimate conservatively.
- affectedResources is an array of script srcs (or "<inline>" for inline scripts) that the finding applies to.
- evidence is a short string pointing to the specific audit id, script src, or attribute that grounded the finding.
- <script type="application/ld+json"> is structured data, not executable JS — do NOT flag it for any reason.
- <script> tags with data-nscript set (any value) are already next/script-managed — do NOT recommend next-script-strategy for them.
- Inline scripts (no src attribute) are not flaggable as render-blocking unless a specific PSI audit explicitly names them in its details.
- React Compiler is forward-looking. Only flag react-compiler when you have direct PSI signal — bootup-time score < 0.9, significant unused-javascript, or large mainthread breakdown — that indicates client-CPU work. Don't recommend it just because the site uses React.
- Middleware-weight is hard to detect from PSI/HTML alone. Only flag it when you have specific evidence (e.g. server-response-time audit failing badly AND the site appears to be on Vercel via x-vercel-id or x-vercel-cache header context). Otherwise skip.
- Do not emit two findings with the same evidence and same vercelFeatureId — combine them into one with the union of affectedResources.
- If there are no real bundle issues, return an empty findings array. Do not invent findings.`;

const SUMMARY_INSTRUCTIONS = `You write 2–3 sentence executive summaries of JavaScript bundle and script-delivery findings for an engineering lead. Tone: concrete, data-grounded, no fluff.

Describe the overall picture — total scripts, third-party fraction, top 1–2 themes in the findings. If the findings list is empty, say the specialist found no bundle issues and note the script counts. Do NOT list findings individually — synthesize a prose summary.

Output only the summary text. No preamble, no headers, no bullets.`;

const MAX_INLINED_SCRIPTS = 25;

export async function runBundleSpecialist(
  slice: BundleSlice,
): Promise<SpecialistOutput> {
  const scriptsByIndex = slice.scripts;
  const thirdPartySrcs = new Set(
    slice.thirdPartyScripts.map((s) => s.src).filter((s): s is string => s != null),
  );

  // closes over the script inventory + the pre-classified third-party set.
  // the full ScriptAsset plus the two derived flags is enough signal - no
  // need to ship raw HTML into the tool.
  const getScriptContext = tool({
    description:
      "Look up parsed attributes for a specific script by src. Matches on exact src or suffix. Returns async/defer/type/data-nscript-strategy, position in document order, total scripts, whether it's third-party (different hostname from the page), and whether it's already next/script-managed.",
    inputSchema: z.object({
      src: z
        .string()
        .min(1)
        .describe(
          "Script URL or a distinctive suffix. Suffix match is tried if exact match fails.",
        ),
    }),
    execute: async ({ src }) => {
      const { script, index } = findScriptBySrc(scriptsByIndex, src);
      if (script == null) {
        return { found: false as const };
      }
      return {
        found: true as const,
        script,
        positionIndex: index,
        totalScripts: scriptsByIndex.length,
        isThirdParty: script.src != null && thirdPartySrcs.has(script.src),
        isNextScript: script.nextScriptStrategy != null,
      };
    },
  });

  // category pinned at construction - same belt-and-braces pattern as the
  // other specialists. category is deterministic per file so theres no
  // reason to leave it to the model.
  const lookupVercelFeature = tool({
    description:
      "Look up a Vercel feature from the BUNDLE subset of the catalog by a free-text concern (e.g. 'GTM loading synchronously', 'unused JavaScript on the page'). Returns the best bundle-category match or { found: false } if nothing in the bundle subset is confident. YOU MUST NOT recommend a Vercel feature you did not receive from this tool.",
    inputSchema: z.object({
      concern: z
        .string()
        .min(1)
        .describe(
          "Free-text description of the JS-bundle concern, in the words of the finding you intend to produce",
        ),
    }),
    execute: async ({ concern }) =>
      catalogLookup({ concern, category: "bundle" }),
  });

  const agent = new ToolLoopAgent({
    model: gateway("anthropic/claude-haiku-4.5"),
    instructions: INSTRUCTIONS,
    tools: {
      get_script_context: getScriptContext,
      lookup_vercel_feature: lookupVercelFeature,
    },
    // 10 matches cache. script-heavy pages make more get_script_context
    // calls, and with four bundle features in the catalog theres more
    // lookup traffic than images two-feature lane.
    stopWhen: stepCountIs(10),
    output: Output.object({ schema: BundleModelOutputSchema }),
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });

  const result = await agent.generate({ prompt: buildPrompt(slice) });
  const { findings } = result.output;

  let summary: string;
  try {
    summary = await generateSummary(slice, findings);
  } catch (err) {
    console.error(
      `[bundle-specialist] summary call failed; returning degraded summary: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    summary = `Summary unavailable. ${findings.length} bundle finding${findings.length === 1 ? "" : "s"} flagged.`;
  }

  return {
    specialist: "bundle",
    findings,
    summary,
  };
}

async function generateSummary(
  slice: BundleSlice,
  findings: z.infer<typeof FindingSchema>[],
): Promise<string> {
  const findingLines =
    findings.length === 0
      ? "(no findings — the specialist found no JS bundle issues to flag)"
      : findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.title} — ${f.estimatedImpact}`,
          )
          .join("\n");

  const { text } = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    system: SUMMARY_INSTRUCTIONS,
    prompt: `URL: ${slice.url}
Performance score: ${formatScore(slice.performanceScore)}
Scripts: ${slice.totalScripts} total (${slice.thirdPartyScripts.length} third-party)
HTML fetch: ${slice.htmlBlocked ? `blocked (${slice.blockReason ?? "unknown"})` : "ok"}

Bundle findings produced by the specialist:
${findingLines}

Write the 2–3 sentence executive summary now.`,
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });
  return text.trim();
}

export function buildPrompt(slice: BundleSlice): string {
  const lines: string[] = [];
  lines.push(`URL: ${slice.url}`);
  lines.push(
    `Lighthouse performance score: ${formatScore(slice.performanceScore)}`,
  );
  lines.push(
    `HTML fetch: ${slice.htmlBlocked ? `BLOCKED (${slice.blockReason ?? "unknown"}) — analyze from PSI only, reduce confidence on attribute-dependent findings` : "ok"}`,
  );
  lines.push("");

  lines.push("## Bundle audits (PSI)");
  const auditEntries = Object.entries(slice.audits);
  if (auditEntries.length === 0) {
    lines.push("(none reported)");
  } else {
    for (const [id, audit] of auditEntries) {
      lines.push(formatAudit(id, audit));
    }
  }
  lines.push("");

  lines.push(
    `## Script inventory (${slice.totalScripts} total, ${slice.thirdPartyScripts.length} third-party${slice.totalScripts > MAX_INLINED_SCRIPTS ? `, first ${MAX_INLINED_SCRIPTS} shown` : ""})`,
  );
  const shown = slice.scripts.slice(0, MAX_INLINED_SCRIPTS);
  if (shown.length === 0) {
    lines.push("(no <script> tags in fetched HTML — site may be a SPA or HTML fetch was blocked)");
  } else {
    for (let i = 0; i < shown.length; i++) {
      lines.push(`${i}. ${formatScript(shown[i])}`);
    }
  }
  lines.push("");

  lines.push(
    "Produce your findings array. Remember: category must be 'bundle', every vercelFeatureId must come from lookup_vercel_feature, cap at 5 findings, severity-ordered.",
  );

  return lines.join("\n");
}

function formatAudit(id: string, audit: PsiAudit): string {
  const parts: string[] = [`- ${id}`];
  parts.push(`score=${audit.score ?? "n/a"}`);
  if (audit.displayValue) parts.push(`display="${audit.displayValue}"`);
  if (typeof audit.numericValue === "number") {
    parts.push(`numeric=${audit.numericValue}`);
  }
  const details = summarizeAuditDetails(audit.details);
  if (details) parts.push(`details=${details}`);
  return parts.join(" ");
}

function formatScript(script: ScriptAsset): string {
  const bits: string[] = [];
  bits.push(`src=${script.src ?? "<inline>"}`);
  if (script.async) bits.push("async");
  if (script.defer) bits.push("defer");
  if (script.type) bits.push(`type=${script.type}`);
  if (script.nextScriptStrategy) {
    bits.push(`next/script=${script.nextScriptStrategy}`);
  }
  return bits.join(" ");
}

function findScriptBySrc(
  scripts: ScriptAsset[],
  src: string,
): { script: ScriptAsset | null; index: number } {
  const exactIndex = scripts.findIndex((s) => s.src === src);
  if (exactIndex >= 0) return { script: scripts[exactIndex], index: exactIndex };
  const suffixIndex = scripts.findIndex(
    (s) => s.src != null && (s.src.endsWith(src) || src.endsWith(s.src)),
  );
  if (suffixIndex >= 0) return { script: scripts[suffixIndex], index: suffixIndex };
  return { script: null, index: -1 };
}

function formatScore(s: number | null): string {
  if (s == null) return "n/a";
  return `${Math.round(s * 100)}/100`;
}
