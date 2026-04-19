import type {
  PsiAudit,
  PsiLighthouseResult,
  HtmlFetchResult,
} from "@/lib/schemas";
import type { ImgAsset, LinkAsset, ParsedAssets, ScriptAsset } from "@/lib/html";

// Per-specialist slicing. Each specialist gets only what its domain needs —
// keeps prompts focused and avoids leaking cross-domain context that would
// bloat tokens and dilute attention. Pure functions; no I/O; the route
// handler composes slices from the already-fetched PSI + HTML payload.

// Audit IDs the image specialist cares about. If Lighthouse renames or drops
// one we'll just see a `null` entry — the specialist is prompted to tolerate
// missing audits rather than error.
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

// Lighthouse's LCP element audit returns details of the form:
//   { type: "table", items: [{ node: { nodeLabel, selector, snippet, path } }] }
// We narrow defensively — `details` is `unknown` in our PSI schema.
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
  // Already filtered to a perf-relevant allowlist by html.ts; pass through
  // verbatim so the specialist can read the wire-level header values.
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

// CDN heuristic: a single header gives us high-confidence provider identity.
// Vercel sets `x-vercel-cache`; Cloudflare sets `cf-cache-status`. We don't
// try to reason about Akamai/Fastly/etc. for v1 — "unknown" is honest.
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

// PsiLighthouseResult.audits is `Record<string, PsiAudit>`, so callers wanting
// a per-audit lookup (e.g. the cache specialist's get_audit_details tool) can
// use this enum-like list to constrain inputs at the schema level.
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
  // Pre-classified third-party scripts: src hostname differs from page origin.
  // Done at extraction time so the agent file never re-derives page-level
  // facts (per the page-level-derivations decision in the chunk plan).
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

// Defensive hostname parse: scripts may be inline (no src), data URIs, or
// malformed. We treat any of those as "can't classify" rather than throwing.
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

// The CWV specialist has two axes: the raw metric audits (LCP, CLS, INP, TBT,
// FCP, SI) and diagnostic audits that explain *why* a metric is slow (LCP
// element, layout-shift elements, long tasks, mainthread breakdown, lazy-
// loaded LCP, font-display). We keep them as separate records on the slice so
// the specialist prompt can anchor findings on metric-level signal and drill
// into diagnostics via the get_cwv_diagnostic tool.
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
  // Preloads with as="font". Surfaces the "is this font preloaded" signal
  // without making the agent filter the raw preload list.
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
