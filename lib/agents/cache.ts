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
import {
  CACHE_AUDIT_ID_LIST,
  type CacheAuditId,
  type CacheSlice,
} from "@/lib/data-slice";

// Same narrowing rationale as image.ts: the model emits findings; the
// specialist field is stamped in code; the summary is generated in a
// dedicated second call (Haiku working-memory issue from Chunk 1).
const CacheModelOutputSchema = z.object({
  findings: z.array(FindingSchema),
});

const INSTRUCTIONS = `You are the cache and delivery specialist on a panel of AI analysts reviewing a web page for Vercel-specific optimization opportunities.

ROLE
Your specialty is HTTP caching, CDN posture, and rendering-strategy fit. You analyze response headers (cache-control, x-vercel-cache, cf-cache-status, age, etag), Lighthouse cache audits, and the relationship between origin response and CDN/edge layer. You do not analyze image bytes, JS bundling, or Core Web Vitals broadly — other specialists cover those. Stay inside your lane.

PROCESS
You will receive a structured slice of PageSpeed Insights cache audits, the page's response headers, and a derived CDN identification. Work in this order:
1. Read the slice. Identify cache audits Lighthouse flagged (score < 0.9 or with non-zero overallSavingsMs).
2. Read the response headers. Note cache-control directives on the root document, the CDN provider, x-vercel-cache hit/miss state, age, and any signal about whether the page is being served from edge or origin.
3. Use get_audit_details(auditId) to drill into the items array of a specific audit when you need per-asset cache TTLs (especially uses-long-cache-ttl and network-requests).
4. Call lookup_vercel_feature for each cache concern you identify. The cache catalog has seven features — map your concern to the best fit.
5. Emit findings ordered by severity (critical → opportunity). Cap at 5 findings — prioritize ruthlessly.

CONSTRAINTS
- Every finding MUST have category = "cache".
- Every finding's vercelFeatureId MUST be an id returned by lookup_vercel_feature in this run. Never invent one.
- The cache catalog has these seven features available. Map findings to whichever fits best:
  (1) isr-stale-content — dynamic rendering used on content that changes rarely (blog posts, product catalog, marketing pages). Fix: ISR / use cache + cacheLife.
  (2) use-cache-fetch — fetch() or data access in Server Components where results are stable across users or within a window. Fix: 'use cache' directive.
  (3) cache-components-ppr — mostly-static page forced fully dynamic by a single dynamic access (cookies, headers, request data). Fix: Cache Components with Partial Prerendering.
  (4) static-asset-headers — missing or weak cache-control on static assets, short max-age on hashed/immutable URLs. Fix: strong cache-control on Vercel Edge Network.
  (5) cdn-bypass — assets served from origin (no CDN hop, x-vercel-cache missing) or from a third party when Vercel would be faster. Fix: serve assets from Vercel Edge Network.
  (6) route-segment-config — no per-route caching strategy; whole app treated uniformly. Fix: Route Segment Config.
  (7) edge-config-flags — feature flags or A/B variants fetched from origin/database on every request. Fix: Edge Config.
  If a concern fits none, drop the finding.
- confidence is a number in [0, 1] reflecting how clearly the data supports the finding. If htmlBlocked is true, drop confidence by 0.2–0.3 on findings that needed response-header data (most cache findings do).
- estimatedImpact is a short phrase (e.g. "~200ms TTFB", "higher CDN hit rate"). Anchor on Lighthouse audit savings when present; otherwise estimate conservatively.
- affectedResources is an array of asset URLs (or "/" for the root document) that the finding applies to.
- evidence is a short string pointing to the specific audit id, header value, or CDN signal that grounded the finding.
- HTML documents typically should NOT have long max-age. cache-control: no-cache or must-revalidate or max-age=0 on the root HTML is correct, not a finding — regardless of how it's framed. Do NOT flag the root document for any cache-control posture (max-age, must-revalidate, no-cache). HTML caching is a framework decision (Next.js + Vercel set these on RSC pages by default), not a customer optimization opportunity.
- x-vercel-cache: HIT combined with max-age=0 on the root HTML is the STANDARD Next.js + Vercel posture for RSC-rendered pages. The HIT means Vercel Edge served the response; the max-age=0 means the browser shouldn't cache. This combination does NOT prove the page is dynamically rendered, and does NOT justify a cache-components-ppr finding. To recommend cache-components-ppr you need direct evidence of slow TTFB (server-response-time audit failing) or evidence the page contains a Suspense-able dynamic island that's forcing whole-page dynamic rendering.
- /api/* paths are dynamic by design — do not flag them for long TTL.
- Do not recommend cdn-bypass when x-vercel-cache is already present in the headers (the page is already served from Vercel Edge).
- Missing headers may simply mean PSI didn't surface them — drop confidence accordingly when relying on header absence rather than presence.
- Do not emit two findings that point at the same evidence and the same vercelFeatureId. If you'd produce two such findings, combine them into one with the union of affectedResources and the higher confidence.
- If there are no real cache issues (e.g. a well-cached site already on Vercel Edge with appropriate TTLs), return an empty findings array. Do not invent findings. A well-configured Vercel-hosted Next.js site producing zero cache findings is the correct, expected outcome.`;

const SUMMARY_INSTRUCTIONS = `You write 2–3 sentence executive summaries of cache and delivery findings for an engineering lead. Tone: concrete, data-grounded, no fluff.

Describe the overall picture — the CDN posture (Vercel / Cloudflare / unknown), whether the page appears to be served from edge, and the top 1–2 themes in the findings. If the findings list is empty, say the specialist found no cache issues and note the CDN provider. Do NOT list findings individually — synthesize a prose summary.

Output only the summary text. No preamble, no headers, no bullets.`;

export async function runCacheSpecialist(
  slice: CacheSlice,
): Promise<SpecialistOutput> {
  // Per-call domain tool: closes over this run's audits. Audit-id input is
  // constrained to the cache subset so the model can't peek at other
  // specialists' audits via this tool.
  const auditIdEnum = z.enum(
    CACHE_AUDIT_ID_LIST as readonly [CacheAuditId, ...CacheAuditId[]],
  );

  const getAuditDetails = tool({
    description:
      "Look up the full Lighthouse details payload for a specific cache-related audit. Returns score, displayValue, numericValue, and the items/savings details (truncated for token economy). Use this to drill into per-asset cache TTLs in uses-long-cache-ttl or to inspect server-response-time / network-requests.",
    inputSchema: z.object({
      auditId: auditIdEnum.describe(
        "The cache audit id to retrieve (must be one of the cache-domain audits in this slice).",
      ),
    }),
    execute: async ({ auditId }) => {
      const audit = slice.audits[auditId];
      if (audit == null) {
        return { found: false as const };
      }
      return {
        found: true as const,
        auditId,
        score: audit.score,
        displayValue: audit.displayValue ?? null,
        numericValue: audit.numericValue ?? null,
        details: summarizeAuditDetails(audit.details),
      };
    },
  });

  // Cache-pinned lookup tool. Same defense-in-depth rationale as image.ts:
  // the category is deterministic per specialist, so we hardcode it at tool
  // construction rather than relying on the model to filter correctly.
  const lookupVercelFeature = tool({
    description:
      "Look up a Vercel feature from the CACHE subset of the catalog by a free-text concern (e.g. 'static assets missing long cache-control', 'page forced dynamic by a single cookie read'). Returns the best cache-category match or { found: false } if nothing in the cache subset is confident. YOU MUST NOT recommend a Vercel feature you did not receive from this tool.",
    inputSchema: z.object({
      concern: z
        .string()
        .min(1)
        .describe(
          "Free-text description of the cache or delivery concern, in the words of the finding you intend to produce",
        ),
    }),
    execute: async ({ concern }) =>
      catalogLookup({ concern, category: "cache" }),
  });

  const agent = new ToolLoopAgent({
    model: gateway("anthropic/claude-haiku-4.5"),
    instructions: INSTRUCTIONS,
    tools: {
      get_audit_details: getAuditDetails,
      lookup_vercel_feature: lookupVercelFeature,
    },
    // Higher cap than image (which uses 6): the cache catalog has 7
    // candidate features vs image's 2, so the model typically makes more
    // lookup_vercel_feature calls before settling on a finding's mapping,
    // and may also drill into multiple audits via get_audit_details.
    // First run against vercel.com hit NoOutputGeneratedError at 6 steps —
    // the model ran out of budget before emitting structured output.
    stopWhen: stepCountIs(10),
    output: Output.object({ schema: CacheModelOutputSchema }),
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });

  const result = await agent.generate({ prompt: buildPrompt(slice) });
  const { findings } = result.output;

  // Same degraded-summary fallback shape as image.ts: log loudly, return a
  // deterministic one-liner, never discard the load-bearing findings.
  let summary: string;
  try {
    summary = await generateSummary(slice, findings);
  } catch (err) {
    console.error(
      `[cache-specialist] summary call failed; returning degraded summary: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    summary = `Summary unavailable. ${findings.length} cache finding${findings.length === 1 ? "" : "s"} flagged.`;
  }

  return {
    specialist: "cache",
    findings,
    summary,
  };
}

async function generateSummary(
  slice: CacheSlice,
  findings: z.infer<typeof FindingSchema>[],
): Promise<string> {
  const findingLines =
    findings.length === 0
      ? "(no findings — the specialist found no cache or delivery issues to flag)"
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
CDN provider: ${slice.cdn.provider}
HTML fetch: ${slice.htmlBlocked ? `blocked (${slice.blockReason ?? "unknown"})` : "ok"}

Cache findings produced by the specialist:
${findingLines}

Write the 2–3 sentence executive summary now.`,
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });
  return text.trim();
}

export function buildPrompt(slice: CacheSlice): string {
  const lines: string[] = [];
  lines.push(`URL: ${slice.url}`);
  lines.push(
    `Lighthouse performance score: ${formatScore(slice.performanceScore)}`,
  );
  lines.push(
    `HTML fetch: ${slice.htmlBlocked ? `BLOCKED (${slice.blockReason ?? "unknown"}) — analyze from PSI only, reduce confidence on header-dependent findings` : "ok"}`,
  );
  lines.push("");

  lines.push("## CDN identification");
  lines.push(`provider: ${slice.cdn.provider}`);
  lines.push("");

  lines.push("## Root document response headers");
  const headerEntries = Object.entries(slice.originHeaders);
  if (headerEntries.length === 0) {
    lines.push("(none returned — HTML fetch likely blocked or upstream stripped them)");
  } else {
    for (const [name, value] of headerEntries) {
      lines.push(`- ${name}: ${truncate(value, 200)}`);
    }
  }
  lines.push("");

  lines.push("## Cache audits (PSI)");
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
    "Produce your findings array. Remember: category must be 'cache', every vercelFeatureId must come from lookup_vercel_feature, cap at 5 findings, severity-ordered.",
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

function formatScore(s: number | null): string {
  if (s == null) return "n/a";
  return `${Math.round(s * 100)}/100`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
