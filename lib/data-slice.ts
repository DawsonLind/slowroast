import type {
  PsiAudit,
  PsiLighthouseResult,
  HtmlFetchResult,
} from "@/lib/schemas";
import type { ImgAsset, LinkAsset, ParsedAssets, ScriptAsset } from "@/lib/html";

// each specialist gets only what it needs for its domain. keeping the slices
// narrow keeps the prompts focused and avoids bleeding cross-domain context
// that would just dilute attention. pure functions, no I/O - the pipeline
// composes them from the already-fetched PSI + HTML

// audit ids the image specialist cares about. if lighthouse renames or drops
// one we get an undefined entry and the specialist prompt is built to shrug
// it off rather than error
const IMAGE_AUDIT_IDS = [
  "uses-optimized-images",
  "uses-webp-images",
  "modern-image-formats",
  "offscreen-images",
  "efficient-animated-content",
  "prioritize-lcp-image",
  "unsized-images",
  "largest-contentful-paint-element",
] as const;

export interface LcpElement {
  nodeLabel: string | null;
  selector: string | null;
  snippet: string | null;
  src: string | null;
}

export interface ImageSlice {
  url: string;
  performanceScore: number | null;
  htmlBlocked: boolean;
  blockReason: string | null;
  images: ImgAsset[];
  totalImagesOnPage: number;
  audits: Partial<Record<(typeof IMAGE_AUDIT_IDS)[number], PsiAudit>>;
  lcpElement: LcpElement | null;
}

export function extractImageSlice(
  psi: PsiLighthouseResult,
  html: HtmlFetchResult,
  assets: ParsedAssets,
): ImageSlice {
  const audits: ImageSlice["audits"] = {};
  for (const id of IMAGE_AUDIT_IDS) {
    const audit = psi.audits[id];
    if (audit) audits[id] = audit;
  }

  return {
    url: psi.finalUrl,
    performanceScore: psi.categories.performance.score,
    htmlBlocked: html.blocked,
    blockReason: html.blocked ? html.reason ?? "unknown" : null,
    images: assets.images,
    totalImagesOnPage: assets.images.length,
    audits,
    lcpElement: parseLcpElement(audits["largest-contentful-paint-element"]),
  };
}

// lighthouse's LCP element audit returns shape:
//   { type: "table", items: [{ node: { nodeLabel, selector, snippet, path } }] }
// narrowing is defensive - `details` is `unknown` in our PSI schema so we
// dont trust a specific shape without checking
function parseLcpElement(audit: PsiAudit | undefined): LcpElement | null {
  if (!audit) return null;
  const details = audit.details;
  if (!isRecord(details)) return null;
  const items = details.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0];
  if (!isRecord(first)) return null;
  const node = first.node;
  if (!isRecord(node)) return null;

  const nodeLabel = asString(node.nodeLabel);
  const selector = asString(node.selector);
  const snippet = asString(node.snippet);

  return {
    nodeLabel,
    selector,
    snippet,
    src: extractSrcFromSnippet(snippet),
  };
}

function extractSrcFromSnippet(snippet: string | null): string | null {
  if (!snippet) return null;
  const match = snippet.match(/\ssrc=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// Cache & delivery specialist slice.
// ---------------------------------------------------------------------------

const CACHE_AUDIT_IDS = [
  "uses-long-cache-ttl",
  "server-response-time",
  "redirects",
  "uses-text-compression",
  "network-requests",
] as const;

export type CacheAuditId = (typeof CACHE_AUDIT_IDS)[number];

export type CdnIdentification =
  | { provider: "vercel"; raw: Record<string, string> }
  | { provider: "cloudflare"; raw: Record<string, string> }
  | { provider: "unknown"; raw: Record<string, string> };

export interface CacheSlice {
  url: string;
  performanceScore: number | null;
  htmlBlocked: boolean;
  blockReason: string | null;
  // html.ts already filtered these down to a perf-relevant allowlist - pass
  // through verbatim so the specialist sees the wire-level header values
  originHeaders: Record<string, string>;
  cdn: CdnIdentification;
  audits: Partial<Record<CacheAuditId, PsiAudit>>;
}

export function extractCacheSlice(
  psi: PsiLighthouseResult,
  html: HtmlFetchResult,
): CacheSlice {
  const audits: CacheSlice["audits"] = {};
  for (const id of CACHE_AUDIT_IDS) {
    const audit = psi.audits[id];
    if (audit) audits[id] = audit;
  }

  return {
    url: psi.finalUrl,
    performanceScore: psi.categories.performance.score,
    htmlBlocked: html.blocked,
    blockReason: html.blocked ? html.reason ?? "unknown" : null,
    originHeaders: html.headers,
    cdn: identifyCdn(html.headers),
    audits,
  };
}

// CDN sniff: a single header tells us the provider with high confidence.
// vercel sets `x-vercel-cache`, cloudflare sets `cf-cache-status`. akamai,
// fastly, and friends arent worth the heuristic complexity for v1 - "unknown"
// is more honest than guessing
function identifyCdn(
  headers: Record<string, string>,
): CdnIdentification {
  if (headers["x-vercel-cache"] != null) {
    return { provider: "vercel", raw: headers };
  }
  if (headers["cf-cache-status"] != null) {
    return { provider: "cloudflare", raw: headers };
  }
  return { provider: "unknown", raw: headers };
}

// PsiLighthouseResult.audits is `Record<string, PsiAudit>`, so anyone wanting
// a constrained per-audit lookup (like the cache specialist's get_audit_details
// tool) can use this list as a zod enum input
export const CACHE_AUDIT_ID_LIST: readonly CacheAuditId[] = CACHE_AUDIT_IDS;

// ---------------------------------------------------------------------------
// JS bundle specialist slice.
// ---------------------------------------------------------------------------

const BUNDLE_AUDIT_IDS = [
  "total-byte-weight",
  "unused-javascript",
  "render-blocking-resources",
  "third-party-summary",
  "bootup-time",
  "legacy-javascript",
  "duplicated-javascript",
] as const;

export type BundleAuditId = (typeof BUNDLE_AUDIT_IDS)[number];

export interface BundleSlice {
  url: string;
  performanceScore: number | null;
  htmlBlocked: boolean;
  blockReason: string | null;
  scripts: ScriptAsset[];
  totalScripts: number;
  // pre-classified third-party scripts (src hostname differs from page
  // origin). done once at extraction time so the agent never has to re-derive
  // this page-level fact inside the tool loop
  thirdPartyScripts: ScriptAsset[];
  preloads: LinkAsset[];
  audits: Partial<Record<BundleAuditId, PsiAudit>>;
}

export function extractBundleSlice(
  psi: PsiLighthouseResult,
  html: HtmlFetchResult,
  assets: ParsedAssets,
): BundleSlice {
  const audits: BundleSlice["audits"] = {};
  for (const id of BUNDLE_AUDIT_IDS) {
    const audit = psi.audits[id];
    if (audit) audits[id] = audit;
  }

  const pageOrigin = safeHostname(psi.finalUrl);
  const thirdPartyScripts = assets.scripts.filter((s) => {
    if (s.src == null) return false;
    const scriptHost = safeHostname(s.src);
    if (scriptHost == null || pageOrigin == null) return false;
    return scriptHost !== pageOrigin;
  });

  return {
    url: psi.finalUrl,
    performanceScore: psi.categories.performance.score,
    htmlBlocked: html.blocked,
    blockReason: html.blocked ? html.reason ?? "unknown" : null,
    scripts: assets.scripts,
    totalScripts: assets.scripts.length,
    thirdPartyScripts,
    preloads: assets.preloads,
    audits,
  };
}

export const BUNDLE_AUDIT_ID_LIST: readonly BundleAuditId[] = BUNDLE_AUDIT_IDS;

// defensive hostname parse. scripts can be inline, data URIs, or just
// malformed - any of those becomes "cant classify" rather than a throw
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core Web Vitals specialist slice.
// ---------------------------------------------------------------------------

// CWV has two flavors of audit: the raw metric scores (LCP, CLS, INP, TBT,
// FCP, SI) and the diagnostic audits that explain *why* a metric is slow
// (LCP element, layout-shift elements, long tasks, mainthread breakdown,
// lazy-loaded LCP, font-display). keeping them as separate records lets the
// prompt anchor on metric-level signal and drill into diagnostics through
// the get_cwv_diagnostic tool - no need to dump both into the base prompt
const CWV_METRIC_AUDIT_IDS = [
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "interaction-to-next-paint",
  "total-blocking-time",
  "first-contentful-paint",
  "speed-index",
] as const;

export type CwvMetricAuditId = (typeof CWV_METRIC_AUDIT_IDS)[number];

const CWV_DIAGNOSTIC_AUDIT_IDS = [
  "largest-contentful-paint-element",
  "layout-shift-elements",
  "long-tasks",
  "mainthread-work-breakdown",
  "lcp-lazy-loaded",
  "font-display",
] as const;

export type CwvDiagnosticAuditId = (typeof CWV_DIAGNOSTIC_AUDIT_IDS)[number];

export interface CwvSlice {
  url: string;
  performanceScore: number | null;
  htmlBlocked: boolean;
  blockReason: string | null;
  metrics: Partial<Record<CwvMetricAuditId, PsiAudit>>;
  diagnostics: Partial<Record<CwvDiagnosticAuditId, PsiAudit>>;
  lcpElement: LcpElement | null;
  // preloads with as="font". pre-filtered here so the agent doesnt have to
  // sift through every preload link to answer "is the font preloaded?"
  fontPreloads: LinkAsset[];
}

export function extractCwvSlice(
  psi: PsiLighthouseResult,
  html: HtmlFetchResult,
  assets: ParsedAssets,
): CwvSlice {
  const metrics: CwvSlice["metrics"] = {};
  for (const id of CWV_METRIC_AUDIT_IDS) {
    const audit = psi.audits[id];
    if (audit) metrics[id] = audit;
  }

  const diagnostics: CwvSlice["diagnostics"] = {};
  for (const id of CWV_DIAGNOSTIC_AUDIT_IDS) {
    const audit = psi.audits[id];
    if (audit) diagnostics[id] = audit;
  }

  const fontPreloads = assets.preloads.filter(
    (p) => (p.as ?? "").toLowerCase() === "font",
  );

  return {
    url: psi.finalUrl,
    performanceScore: psi.categories.performance.score,
    htmlBlocked: html.blocked,
    blockReason: html.blocked ? html.reason ?? "unknown" : null,
    metrics,
    diagnostics,
    lcpElement: parseLcpElement(diagnostics["largest-contentful-paint-element"]),
    fontPreloads,
  };
}

export const CWV_METRIC_AUDIT_ID_LIST: readonly CwvMetricAuditId[] =
  CWV_METRIC_AUDIT_IDS;
export const CWV_DIAGNOSTIC_AUDIT_ID_LIST: readonly CwvDiagnosticAuditId[] =
  CWV_DIAGNOSTIC_AUDIT_IDS;
