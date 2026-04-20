"use client";

import { useEffect, useRef, useState } from "react";
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
  positive: "text-emerald-400",
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

// Linear count-up over `durationMs`. Always initializes to `target` so the
// server-rendered HTML matches the initial client render (no hydration
// mismatch). After hydration we kick off the count-up from 0 → target;
// under prefers-reduced-motion we skip the animation entirely.
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) {
      setValue(target);
      return;
    }
    setValue(0);
    startRef.current = null;
    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}
