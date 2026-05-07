"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiFormat = "int" | "percent" | "seconds";

export interface KpiTileProps {
  label: string;
  // The target numeric value the counter animates toward.
  value: number;
  // Format kind — enum, not a function, because this component renders from
  // a server component and function props don't cross the RSC boundary.
  format?: KpiFormat;
  sub?: string;
  // Optional accent: tints the value text and a faint background wash.
  accent?: "primary" | "image" | "bundle" | "cache" | "cwv" | "positive" | "neutral";
}

const ACCENT_TEXT: Record<NonNullable<KpiTileProps["accent"]>, string> = {
  primary: "text-primary",
  image: "text-roast-image",
  bundle: "text-roast-bundle",
  cache: "text-roast-cache",
  cwv: "text-roast-cwv",
  positive: "text-[color:var(--color-roast-positive)]",
  neutral: "text-foreground",
};

export function KpiTile({
  label,
  value,
  format = "int",
  sub,
  accent = "neutral",
}: KpiTileProps) {
  const display = useCountUp(value, 900);
  const fmt = formatValue;
  return (
    <Card
      className={cn(
        "group cursor-default transition-all duration-200",
        "hover:-translate-y-0.5 hover:ring-1 hover:ring-foreground/20",
        accent === "positive" && "hover:shadow-[0_0_24px_-8px_var(--color-roast-positive)]",
        accent === "primary" && "hover:shadow-[0_0_24px_-8px_var(--color-primary)]",
        accent === "cache" && "hover:shadow-[0_0_24px_-8px_var(--color-roast-cache)]",
        accent === "cwv" && "hover:shadow-[0_0_24px_-8px_var(--color-roast-cwv)]",
        accent === "image" && "hover:shadow-[0_0_24px_-8px_var(--color-roast-image)]",
        accent === "bundle" && "hover:shadow-[0_0_24px_-8px_var(--color-roast-bundle)]",
        accent === "neutral" && "hover:shadow-[0_0_24px_-8px_var(--color-foreground)]",
      )}
    >
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "font-heading text-3xl font-semibold tabular-nums leading-none transition-transform duration-200",
            "group-hover:scale-[1.03]",
            ACCENT_TEXT[accent],
          )}
        >
          {fmt(display, format)}
        </div>
        {sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatValue(n: number, kind: KpiFormat): string {
  switch (kind) {
    case "percent":
      return `${Math.round(n)}%`;
    case "seconds":
      return `${n.toFixed(1)}s`;
    case "int":
      return `${Math.round(n)}`;
  }
}

// Eased count-up over `durationMs`. Initial state is `target` so SSR HTML
// matches the first client render (no hydration mismatch); the rAF loop
// snaps to 0 on its first tick (t=0 → eased=0) and animates up to target.
// Under prefers-reduced-motion we collapse duration to 0 so the first tick
// resolves at t=1 immediately.
//
// All setValue calls happen inside the rAF callback rather than synchronously
// in the effect body — that's required by react-hooks/set-state-in-effect.
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const reducedMq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const duration = reducedMq?.matches ? 0 : durationMs;

    let raf: number | null = null;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const t = duration === 0 ? 1 : Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  return value;
}
