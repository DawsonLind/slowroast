"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type PhaseStatus = "pending" | "running" | "done";

export interface PsiCardProps {
  psiStatus: PhaseStatus;
  htmlStatus: PhaseStatus;
  elapsedMs: number;
}

// Temporary "data collection" card that fronts the specialist grid while the
// deterministic phase (PSI + direct HTML fetch) is in flight. PSI is the
// critical path — Google runs a real Lighthouse audit in their infra and it
// regularly takes 20–45s, which is otherwise invisible to the user because
// specialists don't start until PSI returns. This card makes that wait legible.
// It unmounts once PSI completes (Analyzer gates the render on
// phases.psi !== "done").
export function PsiCard({ psiStatus, htmlStatus, elapsedMs }: PsiCardProps) {
  return (
    <Card className="min-h-[160px] ring-1 ring-border">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="roast-dot inline-block h-1.5 w-1.5 rounded-full" />
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Data collection · PageSpeed Insights + HTML
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {(elapsedMs / 1000).toFixed(0)}s
          </span>
        </div>
        <CardTitle className="text-lg">
          Running Lighthouse audit in Google&apos;s infra…
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Specialists don&apos;t start until the facts are in. PSI runs a real
          Lighthouse audit server-side; we fetch raw HTML in parallel to capture
          response headers and the unminified markup. Typical PSI call:
          20–45 seconds.
        </p>

        <div className="flex items-center gap-4">
          <div className="roast-rings shrink-0">
            <span />
            <span />
            <span />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <PhaseRow label="PageSpeed Insights" status={psiStatus} />
            <PhaseRow label="HTML + headers" status={htmlStatus} />
            <div className="roast-bar h-1" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PhaseRow({ label, status }: { label: string; status: PhaseStatus }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <StatusDot status={status} />
      <span
        className={cn(
          "flex-1",
          status === "done" ? "text-foreground/80" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {status === "running" ? "fetching" : status === "done" ? "ready" : "queued"}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: PhaseStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />;
}
