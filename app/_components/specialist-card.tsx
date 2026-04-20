"use client";

import type { CSSProperties } from "react";
import {
  Image as ImageIcon,
  Package,
  Database,
  Activity,
  AlertTriangle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FindingCategory, Severity } from "@/lib/schemas";
import { SPECIALIST_META } from "@/lib/ui-meta";

export type SpecialistStatus = "idle" | "working" | "near-done" | "done" | "error";

const CATEGORY_ICON: Record<FindingCategory, typeof ImageIcon> = {
  image: ImageIcon,
  bundle: Package,
  cache: Database,
  cwv: Activity,
};

const WORKING_STATUS_LINES: Record<FindingCategory, readonly string[]> = {
  image: [
    "Reading PSI image audits…",
    "Inspecting LCP element…",
    "Cross-referencing next/image…",
  ],
  bundle: [
    "Parsing bundle inventory…",
    "Scoring render-blocking scripts…",
    "Checking next/script strategies…",
  ],
  cache: [
    "Inspecting response headers…",
    "Resolving CDN + cache-control…",
    "Mapping to Cache Components…",
  ],
  cwv: [
    "Reading lab metrics…",
    "Tracing LCP element attribution…",
    "Scoping vs image/bundle lanes…",
  ],
};

export interface SpecialistCardState {
  category: FindingCategory;
  status: SpecialistStatus;
  elapsedMs: number;
  findingsCount?: number;
  topSeverity?: Severity;
  onClick?: () => void;
}

export function SpecialistCard({
  category,
  status,
  elapsedMs,
  findingsCount,
  topSeverity,
  onClick,
}: SpecialistCardState) {
  const meta = SPECIALIST_META[category];
  const Icon = CATEGORY_ICON[category];
  const accentStyle: CSSProperties = {
    ["--accent-color" as string]: `var(--${meta.accentVar})`,
  };

  const isInteractive = status === "done" && !!onClick;

  return (
    <div
      style={accentStyle}
      onClick={isInteractive ? onClick : undefined}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 text-sm",
        "ring-1 ring-foreground/10 transition-all",
        status === "working" || status === "near-done"
          ? "roast-pulse"
          : undefined,
        status === "done" && "ring-[color:var(--accent-color)]/40",
        status === "error" && "opacity-70 ring-destructive/30",
        isInteractive && "cursor-pointer hover:ring-[color:var(--accent-color)]/70",
      )}
    >
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-[color:var(--accent-color)]/30",
              status === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-[color:var(--accent-color)]/10 text-[color:var(--accent-color)]",
            )}
          >
            {status === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-heading text-sm font-medium">
              {meta.shortLabel}
            </span>
            <span className="text-[11px] text-muted-foreground">
              specialist
            </span>
          </div>
        </div>
        <StatusIndicator status={status} elapsedMs={elapsedMs} />
      </div>

      <p className="relative z-10 text-xs leading-relaxed text-muted-foreground">
        {meta.description}
      </p>

      <div className="relative z-10 mt-auto">
        {status === "idle" ? <IdleFooter /> : null}
        {status === "working" || status === "near-done" ? (
          <WorkingFooter
            category={category}
            elapsedMs={elapsedMs}
            intensified={status === "near-done"}
          />
        ) : null}
        {status === "done" ? (
          <DoneFooter
            findingsCount={findingsCount ?? 0}
            topSeverity={topSeverity}
          />
        ) : null}
        {status === "error" ? <ErrorFooter /> : null}
      </div>
    </div>
  );
}

function StatusIndicator({
  status,
  elapsedMs,
}: {
  status: SpecialistStatus;
  elapsedMs: number;
}) {
  if (status === "idle") {
    return (
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        ready
      </span>
    );
  }
  if (status === "working" || status === "near-done") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full roast-dot" />
        <span className="font-mono tabular-nums">
          {(elapsedMs / 1000).toFixed(0)}s
        </span>
      </div>
    );
  }
  if (status === "done") {
    return (
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[color:var(--accent-color)]">
        <Check className="h-3 w-3" />
        done
      </span>
    );
  }
  return (
    <span className="text-[11px] uppercase tracking-wider text-destructive">
      failed
    </span>
  );
}

function IdleFooter() {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
      <span>Awaiting URL</span>
      <span className="font-mono opacity-60">—</span>
    </div>
  );
}

function WorkingFooter({
  category,
  elapsedMs,
  intensified,
}: {
  category: FindingCategory;
  elapsedMs: number;
  intensified: boolean;
}) {
  const lines = WORKING_STATUS_LINES[category];
  // Cycle through status lines at ~3s intervals; intensified near the end.
  const interval = intensified ? 2000 : 3500;
  const idx = Math.min(lines.length - 1, Math.floor(elapsedMs / interval));
  return (
    <div className="flex flex-col gap-2">
      <div className="roast-bar h-1" />
      <div className="text-[11px] text-muted-foreground">
        <span className="font-mono">{lines[idx]}</span>
      </div>
    </div>
  );
}

function DoneFooter({
  findingsCount,
  topSeverity,
}: {
  findingsCount: number;
  topSeverity?: Severity;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-baseline gap-1.5">
        <span className="font-heading text-2xl font-semibold tabular-nums">
          {findingsCount}
        </span>
        <span className="text-xs text-muted-foreground">
          finding{findingsCount === 1 ? "" : "s"}
        </span>
      </div>
      {topSeverity ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            SEVERITY_DOT_STYLES[topSeverity],
          )}
        >
          worst: {topSeverity}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">clean</span>
      )}
    </div>
  );
}

function ErrorFooter() {
  return (
    <div className="text-[11px] text-muted-foreground">
      Specialist degraded — see banner above.
    </div>
  );
}

const SEVERITY_DOT_STYLES: Record<Severity, string> = {
  critical: "bg-sev-critical/20 text-sev-critical",
  high: "bg-sev-high/20 text-sev-high",
  medium: "bg-sev-medium/20 text-sev-medium",
  opportunity: "bg-sev-opportunity/20 text-sev-opportunity",
};
