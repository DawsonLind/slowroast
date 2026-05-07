"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2, AlertTriangle } from "lucide-react";

export type PhaseStatus = "pending" | "running" | "done" | "failed";

export interface PipelineStatusProps {
  // Total wall-clock elapsed in ms — live-ticked by the analyzer.
  elapsedMs: number;
  // What's happening right now, in one short sentence. Drives the headline.
  headline: string;
  // Top-level pipeline state (drives the eyebrow + tone).
  variant: "running" | "complete" | "error";

  // Per-phase rollup. We always render all three rows so the user can see the
  // upcoming work, not just the current step.
  data: PhaseRowState;
  specialists: PhaseRowState & {
    doneCount: number;
    runningLabels: string[];
  };
  synth: PhaseRowState;
}

interface PhaseRowState {
  status: PhaseStatus;
  // Once the phase is done, this is the final duration. While running, it's
  // a live count from when the phase started. Undefined while pending.
  durationMs?: number;
}

// Persistent status banner shown during analysis. Replaces the previous
// data-collection-only PsiCard with a full-pipeline view that stays mounted
// from the first POST through synth — so the user always knows where we are
// and how long they've been waiting.
export function PipelineStatus(props: PipelineStatusProps) {
  const { elapsedMs, headline, variant, data, specialists, synth } = props;

  const eyebrow =
    variant === "complete"
      ? "Analysis complete"
      : variant === "error"
        ? "Analysis halted"
        : "Analyzing";

  return (
    <Card
      className={cn(
        "ring-1",
        variant === "error"
          ? "border-destructive/30 bg-destructive/5 ring-destructive/20"
          : "ring-foreground/10",
      )}
    >
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div
              className={cn(
                "text-xs uppercase tracking-wider",
                variant === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {eyebrow}
            </div>
            <div className="text-base font-medium leading-snug text-foreground">
              {headline}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-heading text-2xl font-semibold tabular-nums leading-none text-foreground">
              {fmtClock(elapsedMs)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              elapsed
            </span>
          </div>
        </div>

        <div className="flex flex-col divide-y divide-border/60">
          <PhaseRow
            label="Data collection"
            sublabel="PageSpeed Insights + HTML"
            status={data.status}
            durationMs={data.durationMs}
          />
          <PhaseRow
            label={
              specialists.status === "pending"
                ? "Specialists"
                : `Specialists (${specialists.doneCount}/4)`
            }
            sublabel={describeSpecialists(specialists)}
            status={specialists.status}
            durationMs={specialists.durationMs}
          />
          <PhaseRow
            label="Synthesizer"
            sublabel="Sonnet · ranking & schema validation"
            status={synth.status}
            durationMs={synth.durationMs}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function describeSpecialists(specialists: PipelineStatusProps["specialists"]): string {
  if (specialists.status === "pending") {
    return "Image · Bundle · Cache · CWV";
  }
  if (specialists.status === "done") {
    return "All four lanes complete";
  }
  if (specialists.status === "failed") {
    return "One or more lanes failed";
  }
  // running
  if (specialists.runningLabels.length === 0) {
    return `${specialists.doneCount} of 4 complete`;
  }
  return `${specialists.runningLabels.join(" · ")} still running`;
}

function PhaseRow({
  label,
  sublabel,
  status,
  durationMs,
}: {
  label: string;
  sublabel: string;
  status: PhaseStatus;
  durationMs?: number;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <PhaseIcon status={status} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-sm font-medium leading-tight",
            status === "pending" && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">{sublabel}</span>
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-xs tabular-nums",
          status === "done"
            ? "text-foreground"
            : status === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
        )}
      >
        {durationMs != null ? fmtSeconds(durationMs) : status === "running" ? "·" : "—"}
      </span>
    </div>
  );
}

function PhaseIcon({ status }: { status: PhaseStatus }) {
  if (status === "done") {
    return (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-[color:var(--color-roast-positive)]"
        aria-hidden
      />
    );
  }
  if (status === "running") {
    return (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
    );
  }
  if (status === "failed") {
    return (
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
    );
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />;
}

function fmtSeconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return fmtClock(ms);
}

function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
