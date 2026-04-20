"use client";

import type { CSSProperties } from "react";
import {
  Image as ImageIcon,
  Package,
  Database,
  Activity,
  AlertTriangle,
  Check,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FindingCategory, Severity } from "@/lib/schemas";
import { SPECIALIST_META, SPECIALIST_TOOLTIP } from "@/lib/ui-meta";

export type SpecialistStatus = "idle" | "queued" | "working" | "done" | "error";

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
  startedAt?: number;
  completedAt?: number;
  findingsCount?: number;
  topSeverity?: Severity;
  onClick?: () => void;
}

export function SpecialistCard({
  category,
  status,
  startedAt,
  completedAt,
  findingsCount,
  topSeverity,
  onClick,
}: SpecialistCardState) {
  const meta = SPECIALIST_META[category];
  const Icon = CATEGORY_ICON[category];
  const accentStyle: CSSProperties = {
    ["--accent-color" as string]: `var(--${meta.accentVar})`,
  };

  // Live elapsed derived from server-reported timestamps. While running, the
  // end point is "now" (ticked by the analyzer's 400ms interval); once done or
  // failed, completedAt freezes it.
  const elapsedMs = computeElapsed(status, startedAt, completedAt);

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
        // No overflow-hidden here: the InfoBubble tooltip needs to escape the
        // card bounds. The animated .roast-pulse and .roast-bar classes
        // already set their own overflow:hidden in globals.css, so dropping
        // the card-level clip doesn't let any animation bleed.
        "group relative flex flex-col gap-3 rounded-xl bg-card p-4 text-sm",
        "ring-1 ring-foreground/10 transition-all",
        status === "working" ? "roast-pulse" : undefined,
        status === "queued" && "opacity-80",
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
            <span className="flex items-center gap-1.5 font-heading text-sm font-medium">
              {meta.shortLabel}
              <InfoBubble text={SPECIALIST_TOOLTIP[category]} label={meta.label} />
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
        {status === "queued" ? <QueuedFooter /> : null}
        {status === "working" ? (
          <WorkingFooter category={category} elapsedMs={elapsedMs} />
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

function computeElapsed(
  status: SpecialistStatus,
  startedAt?: number,
  completedAt?: number,
): number {
  if (startedAt == null) return 0;
  const end = completedAt ?? Date.now();
  return Math.max(0, end - startedAt);
}

// Plain-language explanation of what this specialist does. CSS-only
// hover/focus via Tailwind group variants — no popover library, no portal,
// no JS state. Keyboard users get the same content on Tab-focus of the
// button. Positioned below the trigger with z-20; the parent card drops its
// overflow-hidden so the bubble can extend past card bounds.
function InfoBubble({ text, label }: { text: string; label: string }) {
  return (
    <span className="group/info relative inline-flex">
      <button
        type="button"
        aria-label={`About ${label} specialist`}
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/60 transition-colors",
          "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-color)]/60",
        )}
      >
        <Info className="h-3 w-3" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-56 rounded-md border border-border bg-popover p-2.5 text-[11px] font-normal normal-case leading-relaxed text-popover-foreground shadow-md",
          "opacity-0 translate-y-1 transition-all duration-150",
          "group-hover/info:pointer-events-auto group-hover/info:opacity-100 group-hover/info:translate-y-0",
          "group-focus-within/info:pointer-events-auto group-focus-within/info:opacity-100 group-focus-within/info:translate-y-0",
        )}
      >
        {text}
      </span>
    </span>
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
        awaiting
      </span>
    );
  }
  if (status === "queued") {
    return (
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
        queued
      </span>
    );
  }
  if (status === "working") {
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
        <span className="font-mono tabular-nums normal-case tracking-normal">
          {(elapsedMs / 1000).toFixed(1)}s
        </span>
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
      <span className="font-mono opacity-60">-</span>
    </div>
  );
}

function QueuedFooter() {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
      <span>Waiting for open slot…</span>
      <span className="font-mono opacity-60">-</span>
    </div>
  );
}

function WorkingFooter({
  category,
  elapsedMs,
}: {
  category: FindingCategory;
  elapsedMs: number;
}) {
  const lines = WORKING_STATUS_LINES[category];
  // Cycle through status lines at ~3.5s intervals. These lines are
  // illustrative of the real work the specialist is doing, but the card's
  // completion is now driven by actual server events — no more theatrical
  // "done" timer.
  const idx = Math.min(lines.length - 1, Math.floor(elapsedMs / 3500));
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
      Specialist degraded - see banner above.
    </div>
  );
}

const SEVERITY_DOT_STYLES: Record<Severity, string> = {
  critical: "bg-sev-critical/20 text-sev-critical",
  high: "bg-sev-high/20 text-sev-high",
  medium: "bg-sev-medium/20 text-sev-medium",
  opportunity: "bg-sev-opportunity/20 text-sev-opportunity",
};
