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

// Observed timings from evals/results.json vercel.com run, used to drive
// the theater-progress windows in the analyzer. These are the "when would
// the real work be done" anchors for each lane under the p-limit(2) wave
// pattern (image+cache in wave 1, bundle+cwv in wave 2).
export const SPECIALIST_DONE_AT_MS: Record<FindingCategory, number> = {
  image: 9_000,
  cache: 13_000,
  cwv: 15_000,
  bundle: 16_000,
};

export const SYNTH_START_AT_MS = 16_000;
