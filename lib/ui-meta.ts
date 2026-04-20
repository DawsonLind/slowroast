import type { FindingCategory } from "@/lib/schemas";

// Single source of truth for per-specialist UI config. Keeps the grid
// component generic — it iterates this table rather than hard-coding the
// four cards.
export interface SpecialistMeta {
  category: FindingCategory;
  label: string;
  shortLabel: string;
  description: string;
  // CSS custom property name whose value is the accent oklch color.
  // Set on the card root via style={{ "--accent-color": `var(--${accentVar})` }}.
  accentVar: string;
  // Tailwind-friendly utility classes for the accent. Defined as string
  // constants rather than inline so we only reference --color-roast-*
  // once per specialist.
  accentText: string;
  accentBg: string;
  accentBorder: string;
}

export const SPECIALIST_META: Record<FindingCategory, SpecialistMeta> = {
  image: {
    category: "image",
    label: "Image",
    shortLabel: "Image",
    description: "Formats, sizing, LCP priority, lazy-loading",
    accentVar: "specialist-image",
    accentText: "text-roast-image",
    accentBg: "bg-roast-image",
    accentBorder: "border-roast-image",
  },
  bundle: {
    category: "bundle",
    label: "JS Bundle",
    shortLabel: "Bundle",
    description: "Unused JS, render-blocking scripts, 3rd-party weight",
    accentVar: "specialist-bundle",
    accentText: "text-roast-bundle",
    accentBg: "bg-roast-bundle",
    accentBorder: "border-roast-bundle",
  },
  cache: {
    category: "cache",
    label: "Cache & Delivery",
    shortLabel: "Cache",
    description: "Headers, CDN routing, ISR, rendering strategy",
    accentVar: "specialist-cache",
    accentText: "text-roast-cache",
    accentBg: "bg-roast-cache",
    accentBorder: "border-roast-cache",
  },
  cwv: {
    category: "cwv",
    label: "Core Web Vitals",
    shortLabel: "CWV",
    description: "LCP, CLS, INP root causes",
    accentVar: "specialist-cwv",
    accentText: "text-roast-cwv",
    accentBg: "bg-roast-cwv",
    accentBorder: "border-roast-cwv",
  },
};

export const SPECIALIST_ORDER: readonly FindingCategory[] = [
  "image",
  "bundle",
  "cache",
  "cwv",
];

// Hover-bubble copy on each specialist card. The card's short `description`
// is a tags-style summary for someone who already knows the domain; these
// are the plain-language version for someone who wants to know what "CWV"
// or "bundle" actually means. Shown via the InfoBubble next to the card
// header.
export const SPECIALIST_TOOLTIP: Record<FindingCategory, string> = {
  image:
    "Checks how images are served — size, format, priority hints, and whether they use Vercel's next/image optimization. Oversized or unoptimized images are a top cause of slow first paint.",
  bundle:
    "Inspects the JavaScript shipped to the browser — render-blocking scripts, third-party tags, and how code is split. Heavy bundles delay when the page becomes interactive.",
  cache:
    "Reviews how responses are cached at the CDN edge and in the browser. Missing or weak cache headers force repeat visits to re-download assets that never changed.",
  cwv:
    "Core Web Vitals are Google's three headline page-experience metrics: how fast the main content appears (LCP), how quickly the page responds to input (INP), and how much the layout shifts as it loads (CLS). They feed into SEO rankings.",
};
