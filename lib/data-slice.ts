import type {
  PsiAudit,
  PsiLighthouseResult,
  HtmlFetchResult,
} from "@/lib/schemas";
import type { ImgAsset, ParsedAssets } from "@/lib/html";

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
