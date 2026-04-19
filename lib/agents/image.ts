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
import type { ImageSlice } from "@/lib/data-slice";
import type { ImgAsset } from "@/lib/html";

// The model's own output schema. Narrower than SpecialistOutputSchema:
// 1. `specialist` is stripped — we know this file is the image specialist,
//    so there's no reason to make the model restate it. Code stamps it
//    back on before returning.
// 2. `summary` is stripped entirely — when we gave it to Haiku as an
//    optional field it was reliably omitted (verified across three runs),
//    and as a required field it was inconsistently emitted. Option C:
//    do findings in the tool-loop call (what Haiku is good at — grounded
//    reasoning over structured inputs) and generate the summary in a
//    dedicated second call with no tools and a trivial output shape.
const ImageModelOutputSchema = z.object({
  findings: z.array(FindingSchema),
});

// AI SDK 6 ToolLoopAgent uses `instructions:`, not `system:`. Three sections —
// role, process, constraints — mirrors architecture.md §4 and §12. The
// constraints section is what enforces catalog grounding at prompt time.
const INSTRUCTIONS = `You are the image-performance specialist on a panel of AI analysts reviewing a web page for Vercel-specific optimization opportunities.

ROLE
Your specialty is image delivery: format (JPEG/PNG vs WebP/AVIF), sizing, lazy-loading, priority hints, above/below-the-fold strategy, and correct use of the next/image component. You do not analyze JavaScript, caching, or Core Web Vitals broadly — other specialists cover those. Stay inside your lane.

PROCESS
You will receive a structured slice of PageSpeed Insights data and the page's <img> inventory. Work in this order:
1. Read the slice. Identify audits Lighthouse flagged (score < 0.9 or numericValue > 0).
2. Use get_image_context to investigate specific images when you need their attributes (loading, fetchpriority, dimensions, next/image marker, LCP-element status).
3. Call lookup_vercel_feature for each image concern you identify. The catalog returns one of two features: next-image-priority or next-image-formats. Map your concern to whichever fits — the features are broad by design. If a concern fits neither (genuinely unrelated to next/image or format conversion), drop the finding.
4. Emit findings ordered by severity (critical → opportunity). Cap at 5 findings — prioritize ruthlessly.

CONSTRAINTS
- Every finding MUST have category = "image".
- Every finding's vercelFeatureId MUST be an id returned by lookup_vercel_feature in this run. Never invent one. The image catalog has two features you can map findings to: (1) next-image-priority — covers raw <img> issues, missing dimensions, missing priority on LCP, missing lazy loading, or any concern that would be solved by migrating to next/image. (2) next-image-formats — covers format conversion (WebP/AVIF), oversized raster images, missing responsive sizes. Every image finding must map to one of these two. If your concern fits neither, drop the finding.
- confidence is a number in [0, 1] reflecting how clearly the data supports the finding. If htmlBlocked is true, drop confidence by 0.2–0.3 on findings that needed HTML attributes.
- estimatedImpact is a short phrase (e.g. "~400ms LCP", "~30% image byte reduction"). Anchor on Lighthouse audit savings when present; otherwise estimate conservatively.
- affectedResources is an array of image srcs (or element selectors for non-<img> LCP elements) that the finding applies to.
- evidence is a short string pointing to the specific audit id or HTML attribute that grounded the finding.
- Images with src=(none) are almost always lazy-load placeholders (data-src populated by JS). Do NOT flag these as broken or missing images. They are a normal lazy-loading pattern.
- SVG handling: when evaluating an image, first check the file extension or Content-Type. For .svg sources, the image is already optimally formatted as vector graphics. Do NOT flag SVGs for format conversion (WebP, AVIF, JPEG, PNG) — that is a category error. SVG-specific recommendations are limited to: inlining for above-the-fold critical icons, minification via SVGO, or conversion to a sprite sheet if there are many small icons. If none of these apply, skip SVG images entirely.
- If there are no real image issues, return an empty findings array. Do not invent findings.`;

const SUMMARY_INSTRUCTIONS = `You write 2–3 sentence executive summaries of image-performance findings for an engineering lead. Tone: concrete, data-grounded, no fluff.

Describe the overall picture — the top 1–2 themes in the findings, anchored on the inventory size and the specific issues flagged. If the findings list is empty, say the specialist found no image issues and note the inventory size. Do NOT list findings individually — synthesize a prose summary.

Output only the summary text. No preamble, no headers, no bullets.`;

export async function runImageSpecialist(
  slice: ImageSlice,
): Promise<SpecialistOutput> {
  const imagesByIndex = slice.images;

  // Per-call tool: closes over this run's slice. Returning the full parsed
  // ImgAsset + derived flags (position, LCP status) is enough signal for the
  // model; no need to hand it raw HTML.
  const getImageContext = tool({
    description:
      "Look up parsed attributes for a specific image by src. Matches on exact src or suffix. Returns loading, fetchpriority, width/height, whether it's a next/image-rendered tag, its index in the page's <img> order, and whether PSI flagged it as the LCP element.",
    inputSchema: z.object({
      src: z
        .string()
        .min(1)
        .describe(
          "Image URL or a distinctive suffix (e.g. '/hero.jpg'). Suffix match is tried if exact match fails.",
        ),
    }),
    execute: async ({ src }) => {
      const { image, index } = findImageBySrc(imagesByIndex, src);
      if (image == null) {
        return { found: false as const };
      }
      const lcpSrc = slice.lcpElement?.src ?? null;
      const isLcpElement = Boolean(
        lcpSrc && (image.src === lcpSrc || lcpSrc.endsWith(image.src ?? "")),
      );
      return {
        found: true as const,
        image,
        positionIndex: index,
        totalImages: imagesByIndex.length,
        isLcpElement,
        // "Above-fold" heuristic: first five <img> in document order. Rough
        // but good enough signal for the specialist's judgment layer.
        likelyAboveFold: index < 5,
      };
    },
  });

  // Image-pinned lookup tool. The catalog-level lookupVercelFeature accepts
  // an optional `category` filter; we hardcode it to "image" here so the
  // model physically cannot retrieve a non-image feature — a defense-in-depth
  // complement to the "drop the finding if no confident match" prompt
  // constraint. Without this pin we saw SVG-sizing concerns mapping to
  // next-image-priority because the specialist's free-text concern tokens
  // matched the feature's `when` field across categories.
  const lookupVercelFeature = tool({
    description:
      "Look up a Vercel feature from the IMAGE subset of the catalog by a free-text concern (e.g. 'hero image missing priority', 'unoptimized image formats'). Returns the best image-category match or { found: false } if nothing in the image subset is confident. YOU MUST NOT recommend a Vercel feature you did not receive from this tool.",
    inputSchema: z.object({
      concern: z
        .string()
        .min(1)
        .describe(
          "Free-text description of the image-performance concern, in the words of the finding you intend to produce",
        ),
    }),
    execute: async ({ concern }) =>
      catalogLookup({ concern, category: "image" }),
  });

  const agent = new ToolLoopAgent({
    model: gateway("anthropic/claude-haiku-4.5"),
    instructions: INSTRUCTIONS,
    tools: {
      get_image_context: getImageContext,
      lookup_vercel_feature: lookupVercelFeature,
    },
    stopWhen: stepCountIs(6),
    output: Output.object({ schema: ImageModelOutputSchema }),
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });

  const result = await agent.generate({ prompt: buildPrompt(slice) });
  const { findings } = result.output;

  // Degraded-summary fallback: if the dedicated summary call fails (gateway
  // rate limit, network, etc.), we don't want to discard the findings — the
  // load-bearing payload. Log the error loudly so it surfaces in eval runs,
  // return a clearly-deterministic one-liner so the synthesizer has
  // something to work with, and keep the shape stable.
  let summary: string;
  try {
    summary = await generateSummary(slice, findings);
  } catch (err) {
    console.error(
      `[image-specialist] summary call failed; returning degraded summary: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    summary = `Summary unavailable. ${findings.length} image finding${findings.length === 1 ? "" : "s"} flagged.`;
  }

  return {
    specialist: "image",
    findings,
    summary,
  };
}

// Second call: dedicated Haiku invocation for the executive summary.
// Keeps the main tool-loop call focused on grounded findings (what Haiku
// does reliably) and moves the free-text generation — which Haiku
// sporadically omits when co-emitted with a structured array — into its
// own trivial text call where the response IS the summary.
async function generateSummary(
  slice: ImageSlice,
  findings: z.infer<typeof FindingSchema>[],
): Promise<string> {
  const findingLines =
    findings.length === 0
      ? "(no findings — the specialist found no image-performance issues to flag)"
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
HTML image inventory: ${slice.totalImagesOnPage} <img> tag${slice.totalImagesOnPage === 1 ? "" : "s"}
HTML fetch: ${slice.htmlBlocked ? `blocked (${slice.blockReason ?? "unknown"})` : "ok"}

Image findings produced by the specialist:
${findingLines}

Write the 2–3 sentence executive summary now.`,
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });
  return text.trim();
}

// Token-economical structured summary. We pass the full audit payloads
// because Lighthouse details carry the specific image URLs and savings
// estimates the specialist needs to ground findings; images are capped
// (totalImagesOnPage still surfaces the real count).
const MAX_INLINED_IMAGES = 30;

function buildPrompt(slice: ImageSlice): string {
  const lines: string[] = [];
  lines.push(`URL: ${slice.url}`);
  lines.push(
    `Lighthouse performance score: ${formatScore(slice.performanceScore)}`,
  );
  lines.push(
    `HTML fetch: ${slice.htmlBlocked ? `BLOCKED (${slice.blockReason ?? "unknown"}) — analyze from PSI only, reduce confidence on attribute-dependent findings` : "ok"}`,
  );
  lines.push("");

  lines.push("## Image audits (PSI)");
  const auditEntries = Object.entries(slice.audits);
  if (auditEntries.length === 0) {
    lines.push("(none reported)");
  } else {
    for (const [id, audit] of auditEntries) {
      lines.push(formatAudit(id, audit));
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
    `## HTML image inventory (${slice.totalImagesOnPage} total${slice.totalImagesOnPage > MAX_INLINED_IMAGES ? `, first ${MAX_INLINED_IMAGES} shown` : ""})`,
  );
  const shown = slice.images.slice(0, MAX_INLINED_IMAGES);
  if (shown.length === 0) {
    lines.push("(no <img> tags in fetched HTML — site may be a SPA or HTML fetch was blocked)");
  } else {
    for (let i = 0; i < shown.length; i++) {
      lines.push(`${i}. ${formatImage(shown[i])}`);
    }
  }
  lines.push("");

  lines.push(
    "Produce your SpecialistOutput. Remember: category must be 'image', every vercelFeatureId must come from lookup_vercel_feature, cap at 5 findings, severity-ordered.",
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
  // Include details when compact — savings hints are in there for several
  // of these audits (e.g. overallSavingsMs, items[].wastedBytes).
  const details = summarizeAuditDetails(audit.details);
  if (details) parts.push(`details=${details}`);
  return parts.join(" ");
}

function formatImage(img: ImgAsset): string {
  const bits: string[] = [];
  bits.push(`src=${img.src ?? "(none)"}`);
  if (img.loading) bits.push(`loading=${img.loading}`);
  if (img.fetchpriority) bits.push(`fetchpriority=${img.fetchpriority}`);
  if (img.width || img.height) bits.push(`size=${img.width ?? "?"}x${img.height ?? "?"}`);
  if (img.srcset) bits.push(`srcset=(present)`);
  if (img.isNextImage) bits.push(`next/image=yes`);
  return bits.join(" ");
}

function findImageBySrc(
  images: ImgAsset[],
  src: string,
): { image: ImgAsset | null; index: number } {
  const exactIndex = images.findIndex((img) => img.src === src);
  if (exactIndex >= 0) return { image: images[exactIndex], index: exactIndex };
  const suffixIndex = images.findIndex(
    (img) => img.src != null && (img.src.endsWith(src) || src.endsWith(img.src)),
  );
  if (suffixIndex >= 0) return { image: images[suffixIndex], index: suffixIndex };
  return { image: null, index: -1 };
}

function formatScore(s: number | null): string {
  if (s == null) return "n/a";
  return `${Math.round(s * 100)}/100`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
