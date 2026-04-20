import { z } from "zod";
import {
  FindingCategorySchema,
  FindingSchema,
  VercelFeatureSchema,
  type VercelFeature,
} from "@/lib/schemas";

// this catalog IS the "no hallucinated recommendations" guarantee, in source
// form. specialists can only surface a vercel feature that lives in here -
// the zod refinement on FindingWithValidatedFeatureSchema below makes that
// mechanical, not advisory.
//
// urls must point at real vercel / next.js docs. any drift gets caught by
// the catalog-URL smoke check under scripts/.

const catalogEntries = [
  {
    id: "next-image-priority",
    title: "Image Optimization via next/image",
    feature: "Image Optimization",
    vercelDocs: "https://vercel.com/docs/image-optimization",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/image",
    category: "image",
    when: "Unoptimized images, wrong formats, missing priority on LCP image, no lazy loading below fold, raw <img> used where next/image would help",
    impact: "Typically 20–50% LCP improvement for image-heavy sites",
    effort: "low",
  },
  {
    id: "next-image-formats",
    title: "Modern image formats (WebP/AVIF) via next/image",
    feature: "Image Optimization",
    vercelDocs: "https://vercel.com/docs/image-optimization",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/image",
    category: "image",
    when: "JPEG/PNG served where WebP or AVIF would save bytes, oversized images, no responsive sizes attribute",
    impact: "20–40% byte savings on image transfers; meaningful LCP and transfer-cost wins",
    effort: "low",
  },
  {
    id: "next-script-strategy",
    title: "next/script with loading strategy",
    feature: "next/script",
    vercelDocs: "https://vercel.com/docs/frameworks/nextjs",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/script",
    category: "bundle",
    when: "Third-party scripts blocking render, <script> tags without async/defer, analytics loaded synchronously",
    impact: "Often 500–1500ms TBT reduction on script-heavy sites",
    effort: "low",
  },
  {
    id: "edge-config-flags",
    title: "Edge Config for feature flags and low-latency config",
    feature: "Edge Config",
    vercelDocs: "https://vercel.com/docs/edge-config",
    nextDocs: "https://nextjs.org/docs/app/api-reference/config/next-config-js",
    category: "cache",
    when: "Feature flags or config fetched from origin/database on every request, A/B test variants loaded from a slow source",
    impact: "Sub-15ms reads vs 50–200ms origin fetches; cuts time-to-first-byte for flag-heavy pages",
    effort: "medium",
  },
  {
    id: "isr-stale-content",
    title: "Incremental Static Regeneration (use cache + cacheLife)",
    feature: "ISR / use cache",
    vercelDocs: "https://vercel.com/docs/incremental-static-regeneration",
    nextDocs: "https://nextjs.org/docs/app/getting-started/caching",
    category: "cache",
    when: "Dynamic rendering used on content that changes rarely (blog, product catalog, marketing pages)",
    impact: "100s of ms TTFB improvement; materially lower origin load",
    effort: "low",
  },
  {
    id: "use-cache-fetch",
    title: "use cache directive for cacheable data",
    feature: "use cache",
    vercelDocs: "https://vercel.com/docs/incremental-static-regeneration",
    nextDocs: "https://nextjs.org/docs/app/api-reference/directives/use-cache",
    category: "cache",
    when: "fetch() or data access in Server Components where results are stable across users or within a window",
    impact: "Eliminates repeated origin fetches; typically 100–500ms per cached dependency",
    effort: "low",
  },
  {
    id: "cache-components-ppr",
    title: "Cache Components with Partial Prerendering",
    feature: "Cache Components",
    vercelDocs: "https://vercel.com/docs/incremental-static-regeneration",
    nextDocs: "https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents",
    category: "cache",
    when: "Mostly-static page forced fully dynamic by a single dynamic access (cookies, headers, request data)",
    impact: "Static shell ships from CDN; LCP improvement of 500ms+ on pages with one dynamic island",
    effort: "medium",
  },
  {
    id: "static-asset-headers",
    title: "Strong cache-control on static assets via Vercel Edge Network",
    feature: "Vercel Edge Network",
    vercelDocs: "https://vercel.com/docs/edge-network/caching",
    nextDocs: "https://nextjs.org/docs/app/api-reference/config/next-config-js/headers",
    category: "cache",
    when: "Missing or weak cache-control on static assets, short max-age on hashed/immutable URLs",
    impact: "Higher CDN hit rate; reduces origin egress and repeat-visit TTFB",
    effort: "low",
  },
  {
    id: "middleware-weight",
    title: "Light Edge Middleware",
    feature: "Edge Middleware",
    vercelDocs: "https://vercel.com/docs/edge-middleware",
    nextDocs: "https://nextjs.org/docs/app/building-your-application/routing/middleware",
    category: "bundle",
    when: "Middleware doing heavy work (auth I/O, rewriting large payloads, calling slow APIs) on every request",
    impact: "Every request shortened; benefit scales with traffic",
    effort: "medium",
  },
  {
    id: "react-compiler",
    title: "React Compiler for automatic memoization",
    feature: "React Compiler",
    vercelDocs: "https://vercel.com/docs/frameworks/nextjs",
    nextDocs: "https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler",
    category: "bundle",
    when: "Heavy client components with frequent re-renders, hand-rolled useMemo/useCallback everywhere",
    impact: "Reduces client CPU on re-renders; smaller INP wins on interactive pages",
    effort: "low",
  },
  {
    id: "font-optimization",
    title: "next/font for self-hosted, subset fonts",
    feature: "next/font",
    vercelDocs: "https://vercel.com/docs/frameworks/nextjs",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/font",
    category: "cwv",
    when: "@font-face loaded from origin or a third-party CDN, no preload, no subsetting, FOIT/FOUT visible",
    impact: "Eliminates external font request in critical path; 200–600ms LCP / CLS improvement",
    effort: "low",
  },
  {
    id: "cdn-bypass",
    title: "Serve assets from Vercel Edge Network, not origin",
    feature: "Vercel Edge Network",
    vercelDocs: "https://vercel.com/docs/edge-network",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/image",
    category: "cache",
    when: "Assets served from origin (no CDN hop, x-vercel-cache missing) or from a third party when Vercel would be faster",
    impact: "Drops asset TTFB into the tens of ms; meaningful for image-heavy pages",
    effort: "medium",
  },
  {
    id: "third-party-tag-manager",
    title: "Tag managers via next/script afterInteractive/lazyOnload",
    feature: "next/script",
    vercelDocs: "https://vercel.com/docs/frameworks/nextjs",
    nextDocs: "https://nextjs.org/docs/app/api-reference/components/script",
    category: "bundle",
    when: "GTM, Segment, or similar tag managers loading synchronously or blocking render",
    impact: "TBT reduction often in the 1000–3000ms range for tag-heavy pages",
    effort: "low",
  },
  {
    id: "route-segment-config",
    title: "Route Segment Config for per-route caching",
    feature: "Route Segment Config",
    vercelDocs: "https://vercel.com/docs/incremental-static-regeneration",
    nextDocs: "https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config",
    category: "cache",
    when: "No route-level caching strategy; whole app treated uniformly dynamic or static",
    impact: "Enables the right cache posture per route; compounding TTFB improvements",
    effort: "low",
  },
  {
    id: "partial-prerendering",
    title: "Partial Prerendering via Suspense boundaries",
    feature: "Partial Prerendering",
    vercelDocs: "https://vercel.com/docs/incremental-static-regeneration",
    nextDocs: "https://nextjs.org/docs/app/getting-started/caching",
    category: "cwv",
    when: "A single dynamic island forces the whole page dynamic; no Suspense boundary around the dynamic work",
    impact: "Static shell streams instantly; LCP improvement proportional to dynamic work skipped",
    effort: "medium",
  },
] as const;

// validated at module load - a bad catalog entry should be a build-time bug,
// not a runtime surprise that breaks a user's analysis.
export const VERCEL_FEATURES: readonly VercelFeature[] = catalogEntries.map(
  (entry) => VercelFeatureSchema.parse(entry),
);

export type VercelFeatureId = (typeof catalogEntries)[number]["id"];

export const VERCEL_FEATURE_IDS: readonly VercelFeatureId[] =
  catalogEntries.map((e) => e.id as VercelFeatureId);

const VERCEL_FEATURE_ID_ENUM = z.enum(
  catalogEntries.map((e) => e.id) as [VercelFeatureId, ...VercelFeatureId[]],
);

// strict variant. use this at synthesis, eval, and any boundary where a
// finding pointing at an unknown feature should be a hard reject.
export const FindingWithValidatedFeatureSchema = FindingSchema.extend({
  vercelFeatureId: VERCEL_FEATURE_ID_ENUM,
});
export type FindingWithValidatedFeature = z.infer<
  typeof FindingWithValidatedFeatureSchema
>;

const featuresById = new Map<string, VercelFeature>(
  VERCEL_FEATURES.map((f) => [f.id, f]),
);

export function getVercelFeatureById(id: string): VercelFeature | undefined {
  return featuresById.get(id);
}

// deterministic keyword match over `when` and `category`. no fuzzy match or
// embeddings - if the agent's concern doesnt overlap, we return
// { found: false } and let the specialist either reframe or drop the
// finding. this is the function each specialist wraps in its own
// `lookup_vercel_feature` tool.
const LookupInputSchema = z.object({
  concern: z.string().min(1),
  category: FindingCategorySchema.optional(),
});

export function lookupVercelFeature(
  input: z.infer<typeof LookupInputSchema>,
): { found: true; feature: VercelFeature } | { found: false } {
  const { concern, category } = LookupInputSchema.parse(input);
  const tokens = tokenize(concern);
  if (tokens.length === 0) return { found: false };

  let best: { feature: VercelFeature; score: number } | null = null;
  for (const feature of VERCEL_FEATURES) {
    if (category && feature.category !== category) continue;
    const haystack = `${feature.when} ${feature.feature} ${feature.title}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (haystack.includes(t)) score += 1;
    if (score > 0 && (best === null || score > best.score)) {
      best = { feature, score };
    }
  }

  return best ? { found: true, feature: best.feature } : { found: false };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}
