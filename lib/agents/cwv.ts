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
import type { CwvSlice } from "@/lib/data-slice";
import type { LinkAsset } from "@/lib/html";

// Same narrowing rationale as image.ts / cache.ts / bundle.ts: model emits
// findings; `specialist` is stamped in code; `summary` is a dedicated
// second call (Haiku working-memory issue from Chunk 1).
const CwvModelOutputSchema = z.object({
  findings: z.array(FindingSchema),
});

const INSTRUCTIONS = `You are the Core Web Vitals specialist on a panel of AI analysts reviewing a web page for Vercel-specific optimization opportunities.

ROLE
Your specialty is the Core Web Vitals metrics themselves (LCP, CLS, INP, TBT, FCP, Speed Index) and the diagnostic audits that explain why a metric is slow. You understand which root cause belongs in which specialist's lane — and you do not stray outside yours. Other specialists (image, bundle, cache) cover the fixes for most CWV root causes; you only emit findings for the narrow set of issues whose fix lives in the CWV catalog.

PROCESS
You will receive a structured slice of PSI metric audits, diagnostic audits, the LCP element (if reported), and any font preload link tags. Work in this order:
1. Read the slice. Note which metrics are failing (LCP > 2.5s, CLS > 0.1, INP > 200ms, TBT > 200ms).
2. Use get_cwv_diagnostic(metric) to drill into the diagnostic payloads for failing metrics — LCP details, layout-shift elements, long tasks, mainthread breakdown.
3. Classify the root cause for each failing metric. This is the critical step:
   - If LCP is slow because of an unoptimized hero image (large bytes, wrong format, raw <img>) → that's the IMAGE specialist's lane. Describe it in the summary, do NOT emit a CWV finding.
   - If INP or TBT is high because of heavy JavaScript (bootup time, long tasks dominated by script evaluation) → that's the BUNDLE specialist's lane. Describe it in the summary, do NOT emit a CWV finding.
   - If LCP is slow because of slow TTFB or no edge caching → that's the CACHE specialist's lane. Describe it in the summary, do NOT emit a CWV finding.
   - If the root cause is a font loading/display issue (missing preload, FOIT, @font-face from origin/3P) → emit a CWV finding mapped to font-optimization.
   - If the root cause is that a single dynamic island forces whole-page dynamic rendering when PPR/Suspense would allow a fast static shell → emit a CWV finding mapped to partial-prerendering.
4. Call lookup_vercel_feature only for concerns that fit the two CWV catalog features. The tool returns { found: false } for anything else; if that happens, drop the finding.
5. Emit findings ordered by severity (critical → opportunity). Cap at 5 findings — usually zero or one in practice.

CONSTRAINTS
- Every finding MUST have category = "cwv".
- Every finding's vercelFeatureId MUST be an id returned by lookup_vercel_feature in this run. Never invent one.
- The CWV catalog has only two features available. Map findings to whichever fits:
  (1) font-optimization — @font-face loaded from origin or a third-party CDN, no preload, no subsetting, FOIT/FOUT visible, font-display audit failing. Fix: next/font for self-hosted, subset fonts.
  (2) partial-prerendering — a single dynamic island (cookies / headers / request data access) forces the whole page dynamic when most of it could be static. Fix: Partial Prerendering with Suspense boundaries.
  If a concern fits neither, DROP the finding. Do not reach for a different category's feature — the image, bundle, and cache specialists handle their own lanes.
- SCOPE BOUNDARY (the most important constraint): The CWV catalog is intentionally narrow because most CWV root causes have their fix in another specialist's lane. You produce zero findings more often than not, and that is the CORRECT shape — not a bug. When the CWV root cause is image bytes, heavy JS, or slow TTFB, describe it in the PROSE SUMMARY only (the other specialist picks up the fix). Do NOT emit a cwv-category finding pointing at a non-CWV Vercel feature.
- confidence is a number in [0, 1]. If htmlBlocked is true, drop confidence by 0.2–0.3 on findings that needed HTML-derived signal (e.g. font preload presence).
- estimatedImpact is a short phrase (e.g. "~300ms LCP improvement from font preload"). Anchor on Lighthouse audit savings when present; otherwise estimate conservatively.
- affectedResources is an array of asset URLs, selectors, or font family names that the finding applies to.
- evidence is a short string pointing to the specific audit id, metric value, or HTML signal that grounded the finding.
- Do not emit two findings with the same evidence and same vercelFeatureId — combine them.
- If there are no CWV-lane issues, return an empty findings array. A page where all CWV problems trace to image/bundle/cache lanes should produce zero findings and a rich prose summary describing those lane attributions.`;

const SUMMARY_INSTRUCTIONS = `You write 2–3 sentence executive summaries of Core Web Vitals findings for an engineering lead. Tone: concrete, data-grounded, no fluff.

Describe the overall CWV picture: which metrics are failing (LCP / CLS / INP / TBT), the root-cause attribution you identified, and which specialist's lane will own each fix. If CWV-specific findings were emitted (font or PPR), lead with those; if the findings list is empty because the root causes belong to the image, bundle, or cache specialists, say so explicitly and name the lane — that is the expected shape, not a gap.

Output only the summary text. No preamble, no headers, no bullets.`;

export async function runCwvSpecialist(
  slice: CwvSlice,
): Promise<SpecialistOutput> {
  // Per-call domain tool. Input constrained to four metric shorthand keys
  // (lcp / cls / inp / tbt) — the diagnostic payloads for each metric differ,
  // so the tool switches on the metric and returns the right subset. Each
  // constituent audit's details runs through summarizeAuditDetails with a
  // tighter charCap (1200) so a two-audit return stays under ~2500 chars.
  const metricEnum = z.enum(["lcp", "cls", "inp", "tbt"]);

  const getCwvDiagnostic = tool({
    description:
      "Drill into the diagnostic audit payload(s) for a specific Core Web Vital. 'lcp' returns the LCP element details + lcp-lazy-loaded audit. 'cls' returns layout-shift-elements details. 'inp' and 'tbt' return long-tasks + mainthread-work-breakdown. Use this to understand WHY a metric is slow before attributing the fix to a specialist's lane.",
    inputSchema: z.object({
      metric: metricEnum.describe(
        "Which CWV metric to diagnose: 'lcp', 'cls', 'inp', or 'tbt'.",
      ),
    }),
    execute: async ({ metric }) => {
      switch (metric) {
        case "lcp": {
          return {
            metric,
            lcpElement: projectAudit(
              slice.diagnostics["largest-contentful-paint-element"],
              { charCap: 1200 },
            ),
            lcpLazyLoaded: projectAudit(
              slice.diagnostics["lcp-lazy-loaded"],
              { charCap: 1200 },
            ),
          };
        }
        case "cls": {
          return {
            metric,
            layoutShiftElements: projectAudit(
              slice.diagnostics["layout-shift-elements"],
              { charCap: 1200 },
            ),
          };
        }
        case "inp":
        case "tbt": {
          return {
            metric,
            longTasks: projectAudit(slice.diagnostics["long-tasks"], {
              charCap: 1200,
            }),
            mainthreadWorkBreakdown: projectAudit(
              slice.diagnostics["mainthread-work-breakdown"],
              { charCap: 1200 },
            ),
          };
        }
      }
    },
  });

  // CWV-pinned lookup tool. Same defense-in-depth pattern as the other
  // specialists: hardcode category at tool construction. With only two CWV
  // features in the catalog, the pin also prevents the keyword matcher from
  // latching onto an image/bundle/cache feature when the concern text
  // coincidentally contains shared tokens (e.g. "image", "script").
  const lookupVercelFeature = tool({
    description:
      "Look up a Vercel feature from the CWV subset of the catalog by a free-text concern (e.g. 'web fonts loaded without preload', 'single dynamic island forcing the whole page dynamic'). The CWV subset has only two features: font-optimization and partial-prerendering. Returns the best match or { found: false } if nothing in the CWV subset is confident. YOU MUST NOT recommend a Vercel feature you did not receive from this tool.",
    inputSchema: z.object({
      concern: z
        .string()
        .min(1)
        .describe(
          "Free-text description of a CWV-lane concern (font loading or partial prerendering), in the words of the finding you intend to produce",
        ),
    }),
    execute: async ({ concern }) =>
      catalogLookup({ concern, category: "cwv" }),
  });

  const agent = new ToolLoopAgent({
    model: gateway("anthropic/claude-haiku-4.5"),
    instructions: INSTRUCTIONS,
    tools: {
      get_cwv_diagnostic: getCwvDiagnostic,
      lookup_vercel_feature: lookupVercelFeature,
    },
    // Match cache's and bundle's higher cap (10): the metric-to-lane
    // classification step often consumes multiple get_cwv_diagnostic calls
    // before the model can decide whether to emit a finding or defer the
    // concern to another specialist's lane in the prose summary.
    stopWhen: stepCountIs(10),
    output: Output.object({ schema: CwvModelOutputSchema }),
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
      `[cwv-specialist] summary call failed; returning degraded summary: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    summary = `Summary unavailable. ${findings.length} CWV finding${findings.length === 1 ? "" : "s"} flagged.`;
  }

  return {
    specialist: "cwv",
    findings,
    summary,
  };
}

async function generateSummary(
  slice: CwvSlice,
  findings: z.infer<typeof FindingSchema>[],
): Promise<string> {
  const findingLines =
    findings.length === 0
      ? "(no findings — root causes for any failing CWV metrics were attributed to other specialists' lanes)"
      : findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.title} — ${f.estimatedImpact}`,
          )
          .join("\n");

  const metricSummary = summarizeMetricsForPrompt(slice);

  const { text } = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    system: SUMMARY_INSTRUCTIONS,
    prompt: `URL: ${slice.url}
Performance score: ${formatScore(slice.performanceScore)}
Key CWV metric values:
${metricSummary}
HTML fetch: ${slice.htmlBlocked ? `blocked (${slice.blockReason ?? "unknown"})` : "ok"}

CWV findings produced by the specialist:
${findingLines}

Write the 2–3 sentence executive summary now. Name the lane (image / bundle / cache) for any failing metric whose fix lives outside the CWV catalog.`,
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });
  return text.trim();
}

function buildPrompt(slice: CwvSlice): string {
  const lines: string[] = [];
  lines.push(`URL: ${slice.url}`);
  lines.push(
    `Lighthouse performance score: ${formatScore(slice.performanceScore)}`,
  );
  lines.push(
    `HTML fetch: ${slice.htmlBlocked ? `BLOCKED (${slice.blockReason ?? "unknown"}) — analyze from PSI only, reduce confidence on HTML-derived findings` : "ok"}`,
  );
  lines.push("");

  lines.push("## CWV metric audits (PSI)");
  const metricEntries = Object.entries(slice.metrics);
  if (metricEntries.length === 0) {
    lines.push("(none reported)");
  } else {
    for (const [id, audit] of metricEntries) {
      lines.push(formatAudit(id, audit));
    }
  }
  lines.push("");

  lines.push("## Diagnostic audits (PSI)");
  const diagnosticEntries = Object.entries(slice.diagnostics);
  if (diagnosticEntries.length === 0) {
    lines.push("(none reported)");
  } else {
    for (const [id, audit] of diagnosticEntries) {
      // Diagnostics contain per-element details the agent will want to drill
      // into via get_cwv_diagnostic; show score + display value here as a
      // signal map, not full details.
      lines.push(formatAuditHeader(id, audit));
    }
  }
  lines.push("");

  lines.push("## LCP element");
  if (slice.lcpElement) {
    const { nodeLabel, selector, snippet, src } = slice.lcpElement;
    lines.push(`- nodeLabel: ${nodeLabel ?? "(none)"}`);
    lines.push(`- selector: ${selector ?? "(none)"}`);
    lines.push(`- src: ${src ?? "(not an image / not extracted)"}`);
    if (snippet) lines.push(`- snippet: ${truncate(snippet, 240)}`);
  } else {
    lines.push("(not reported)");
  }
  lines.push("");

  lines.push(
    `## Font preloads (${slice.fontPreloads.length} with as="font")`,
  );
  if (slice.fontPreloads.length === 0) {
    lines.push(
      "(no <link rel=preload as=font> in fetched HTML — either no web fonts, no preload strategy, or HTML fetch was blocked)",
    );
  } else {
    for (const p of slice.fontPreloads) {
      lines.push(`- ${formatFontPreload(p)}`);
    }
  }
  lines.push("");

  lines.push(
    "Produce your findings array. Remember: the CWV catalog has only two features (font-optimization, partial-prerendering). For any failing metric whose fix lives in another specialist's lane (image / bundle / cache), describe it in the summary only and do NOT emit a finding. Cap at 5 findings; zero is often correct.",
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

// Header-only projection for diagnostic audits; full details are reachable
// via get_cwv_diagnostic so we don't need to inline them in the prompt.
function formatAuditHeader(id: string, audit: PsiAudit): string {
  const parts: string[] = [`- ${id}`];
  parts.push(`score=${audit.score ?? "n/a"}`);
  if (audit.displayValue) parts.push(`display="${audit.displayValue}"`);
  if (typeof audit.numericValue === "number") {
    parts.push(`numeric=${audit.numericValue}`);
  }
  return parts.join(" ");
}

function projectAudit(
  audit: PsiAudit | undefined,
  opts: { charCap?: number } = {},
): {
  found: boolean;
  score?: number | null;
  displayValue?: string | null;
  numericValue?: number | null;
  details?: string | null;
} {
  if (audit == null) return { found: false };
  return {
    found: true,
    score: audit.score,
    displayValue: audit.displayValue ?? null,
    numericValue: audit.numericValue ?? null,
    details: summarizeAuditDetails(audit.details, opts),
  };
}

function summarizeMetricsForPrompt(slice: CwvSlice): string {
  const rows: string[] = [];
  for (const [id, audit] of Object.entries(slice.metrics)) {
    const score = audit.score == null ? "n/a" : audit.score.toFixed(2);
    const display = audit.displayValue ?? "n/a";
    rows.push(`- ${id}: ${display} (score ${score})`);
  }
  return rows.length > 0 ? rows.join("\n") : "(none reported)";
}

function formatFontPreload(p: LinkAsset): string {
  const bits: string[] = [];
  bits.push(`href=${p.href ?? "(none)"}`);
  if (p.crossorigin) bits.push(`crossorigin=${p.crossorigin}`);
  return bits.join(" ");
}

function formatScore(s: number | null): string {
  if (s == null) return "n/a";
  return `${Math.round(s * 100)}/100`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
