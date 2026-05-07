"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export interface SuccessRateRow {
  url: string;
  host: string;
  successful: number;
  attempted: number;
}

// Responsive HTML chart. Replaces the previous fixed-width SVG
// (CHART_WIDTH=720) which became unreadable below ~600px because the labels
// scaled down with the SVG. Mobile stacks label + bar; desktop keeps the
// horizontal "label | bar | pct" alignment.
export function SuccessRateChart({ rows }: { rows: SuccessRateRow[] }) {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // When reduced motion is on we collapse the duration to 0; the rAF
    // callback then snaps progress to 1 on its first tick. Keeping the
    // setProgress call inside the rAF callback (rather than synchronous in
    // the effect body) avoids react-hooks/set-state-in-effect.
    let raf: number | null = null;
    const start = performance.now();
    const duration = reduced ? 0 : 900;
    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div
      role="img"
      aria-label="Success rate per URL"
      className="flex flex-col gap-3"
    >
      {rows.map((row) => {
        const rate = row.attempted === 0 ? 0 : row.successful / row.attempted;
        const pct = Math.round(rate * 100);
        const color = rateColor(rate);
        const animatedPct = pct * progress;
        return (
          <div
            key={row.url}
            className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
          >
            <div className="flex items-center justify-between gap-3 sm:w-44 sm:justify-start sm:gap-2">
              <span
                className="min-w-0 truncate font-mono text-xs font-medium"
                title={row.host}
              >
                {row.host}
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5 sm:hidden">
                <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                  {pct}%
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {row.successful}/{row.attempted}
                </span>
              </span>
            </div>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/40">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${animatedPct}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <div className="hidden shrink-0 items-baseline justify-end gap-2 sm:flex sm:w-24">
              <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                {pct}%
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {row.successful}/{row.attempted}
              </span>
            </div>
          </div>
        );
      })}
      {/* Axis ticks. Desktop only — on mobile they'd misalign with the
          stacked layout and add noise without value. */}
      <div className="hidden items-center text-[10px] tabular-nums text-muted-foreground sm:flex sm:pl-44 sm:pr-24">
        <span className="flex-1 text-left">0%</span>
        <span className="flex-1 text-center">50%</span>
        <span className="flex-1 text-right">100%</span>
      </div>
    </div>
  );
}

// Bands chosen to match the demo's narrative: >80% = clearly shipping green,
// 40–80% = amber warning, <40% = red.
function rateColor(rate: number): string {
  if (rate > 0.8) return "var(--color-roast-positive)";
  if (rate >= 0.4) return "var(--color-sev-medium)";
  return "var(--color-sev-critical)";
}

// useSyncExternalStore is the React 19 way to subscribe to a browser state
// source like matchMedia. It also fixes the SSR snapshot (always false on
// the server) so we don't hit a hydration mismatch when the user has
// prefers-reduced-motion enabled.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
