"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SuccessRateRow {
  url: string;
  host: string;
  successful: number;
  attempted: number;
}

const BAR_HEIGHT = 16;
const BAR_GAP = 10;
const LABEL_WIDTH = 148;
const RIGHT_PADDING = 64;
const CHART_WIDTH = 720;

export function SuccessRateChart({ rows }: { rows: SuccessRateRow[] }) {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    let raf: number;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic — same curve as the KPI tiles so the dashboard
      // settles as one gesture, not four unsynced ones.
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const height = rows.length * BAR_HEIGHT + (rows.length - 1) * BAR_GAP;
  const plotLeft = LABEL_WIDTH;
  const plotRight = CHART_WIDTH - RIGHT_PADDING;
  const plotWidth = plotRight - plotLeft;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${height + 28}`}
        width="100%"
        role="img"
        aria-label="Success rate per URL"
        className="font-sans"
      >
        {/* Axis ticks at 0, 50, 100% */}
        {[0, 0.5, 1].map((t) => {
          const x = plotLeft + plotWidth * t;
          return (
            <g key={t}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={height + 4}
                stroke="currentColor"
                strokeOpacity={t === 0 || t === 1 ? 0.18 : 0.08}
                strokeDasharray={t === 0.5 ? "2 3" : undefined}
                className="text-foreground"
              />
              <text
                x={x}
                y={height + 18}
                fontSize={10}
                textAnchor="middle"
                className="fill-muted-foreground"
              >
                {`${Math.round(t * 100)}%`}
              </text>
            </g>
          );
        })}

        {rows.map((row, i) => {
          const rate = row.attempted === 0 ? 0 : row.successful / row.attempted;
          const y = i * (BAR_HEIGHT + BAR_GAP);
          const animatedWidth = plotWidth * rate * progress;
          const color = rateColor(rate);
          const pct = Math.round(rate * 100);
          return (
            <g key={row.url}>
              <text
                x={plotLeft - 10}
                y={y + BAR_HEIGHT / 2}
                fontSize={11}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-foreground font-mono"
              >
                {truncate(row.host, 20)}
              </text>
              {/* Track */}
              <rect
                x={plotLeft}
                y={y}
                width={plotWidth}
                height={BAR_HEIGHT}
                rx={BAR_HEIGHT / 2}
                className="fill-muted"
                fillOpacity={0.35}
              />
              {/* Fill */}
              <rect
                x={plotLeft}
                y={y}
                width={Math.max(0, animatedWidth)}
                height={BAR_HEIGHT}
                rx={BAR_HEIGHT / 2}
                fill={color}
              />
              <text
                x={plotRight + 8}
                y={y + BAR_HEIGHT / 2}
                fontSize={11}
                dominantBaseline="central"
                className={cn("fill-foreground font-mono tabular-nums")}
              >
                {`${pct}%`}
                <tspan
                  dx={6}
                  fontSize={10}
                  className="fill-muted-foreground"
                >
                  {`${row.successful}/${row.attempted}`}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Success-rate → color. Bands chosen to match the demo's narrative:
// >80% = clearly shipping green, 40–80% = amber warning, <40% = red.
function rateColor(rate: number): string {
  if (rate > 0.8) return "var(--color-roast-positive)";
  if (rate >= 0.4) return "var(--color-sev-medium)";
  return "var(--color-sev-critical)";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}
