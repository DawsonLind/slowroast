"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export type PhaseStatus = "pending" | "running" | "done";

export interface PsiCardProps {
  psiStatus: PhaseStatus;
  htmlStatus: PhaseStatus;
  elapsedMs: number;
}

interface LogLine {
  id: string;
  at: number;
  kind: "info" | "done";
  text: string;
}

// Temp data-collection card shown while PSI + HTML fetch are in flight.
// PSI is the critical path here — Google runs a real Lighthouse audit
// which regularly takes 20–45s, and specialists don't start until it returns.
// The log below is anchored to real phase events (psiStatus/htmlStatus flips)
// plus a couple of elapsed-time thresholds; no line claims something that
// isn't actually happening. Analyzer unmounts this the moment phases.psi
// flips to "done".
export function PsiCard({ psiStatus, htmlStatus, elapsedMs }: PsiCardProps) {
  const [lines, setLines] = useState<LogLine[]>([]);

  useEffect(() => {
    setLines((prev) => {
      const ids = new Set(prev.map((l) => l.id));
      const next = [...prev];
      const add = (id: string, at: number, kind: LogLine["kind"], text: string) => {
        if (ids.has(id)) return;
        ids.add(id);
        next.push({ id, at, kind, text });
      };

      add("psi-start", 0, "info", "→ POST pagespeedonline.googleapis.com/runPagespeed");
      add("html-start", 0, "info", "→ GET origin (headers + body)");

      if (elapsedMs >= 2000) {
        add("psi-wait", 2000, "info", "· Lighthouse audit running in Google's infra");
      }
      if (htmlStatus === "done") {
        add("html-done", elapsedMs, "done", "✓ HTML + response headers received");
      }
      if (elapsedMs >= 20000 && psiStatus !== "done") {
        add("psi-long", 20000, "info", "· still waiting on Lighthouse (typical 20–45s)");
      }
      if (psiStatus === "done") {
        add("psi-done", elapsedMs, "done", "✓ PSI audit complete, dispatching specialists");
      }

      return next;
    });
  }, [elapsedMs, psiStatus, htmlStatus]);

  return (
    <Card className="bg-card/60 ring-1 ring-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              aria-hidden
            />
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Data collection · PageSpeed Insights + HTML
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {(elapsedMs / 1000).toFixed(0)}s
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-6"
          aria-live="polite"
        >
          {lines.length === 0 ? (
            <div className="text-muted-foreground/60">warming up…</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="flex items-start gap-3">
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground/60">
                  [{(line.at / 1000).toFixed(1)}s]
                </span>
                <span
                  className={cn(
                    line.kind === "done"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground/80",
                  )}
                >
                  {line.text}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
