"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FindingCategory, Report } from "@/lib/schemas";
import { SPECIALIST_META, SPECIALIST_ORDER } from "@/lib/ui-meta";
import { FindingCard } from "./finding-card";

export type SynthStatus = "waiting" | "synthesizing" | "success" | "error";

export interface SynthCardProps {
  status: SynthStatus;
  elapsedMs: number;
  specialistDoneCount: number;
  report?: Report;
  errorMessage?: string;
  errorKind?: string;
  onRetry?: () => void;
}

export function SynthCard(props: SynthCardProps) {
  const { status } = props;
  const isFlipped = status === "success" || status === "error";

  return (
    <div className="flip-container">
      <div className={cn("flip-inner", isFlipped && "is-flipped")}>
        <div className="flip-face">
          <SynthFront {...props} />
        </div>
        <div className="flip-face flip-face--back">
          <SynthBack {...props} />
        </div>
      </div>
    </div>
  );
}

function SynthFront({
  status,
  elapsedMs,
  specialistDoneCount,
}: SynthCardProps) {
  return (
    <Card className="min-h-[220px] ring-2 ring-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="roast-dot inline-block h-1.5 w-1.5 rounded-full" />
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Synthesizer · Sonnet 4.6
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {(elapsedMs / 1000).toFixed(0)}s
          </span>
        </div>
        <CardTitle className="text-lg">
          {status === "waiting"
            ? "Waiting for specialists to finish…"
            : "Prioritizing the roadmap…"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === "waiting" ? (
            <>
              Four specialists run in parallel first. When they land, Sonnet
              ranks their findings by impact × ease and produces a structured
              report under a Zod-validated schema.
            </>
          ) : (
            <>
              Sonnet is merging findings across {specialistDoneCount} specialist{" "}
              {specialistDoneCount === 1 ? "lane" : "lanes"}, validating every
              recommendation against the Vercel feature catalog, and emitting
              an executive summary.
            </>
          )}
        </p>

        <div className="flex flex-col gap-3">
          <SpecialistProgressPills doneCount={specialistDoneCount} />
          <div className="flex items-center gap-4">
            <div className="roast-rings">
              <span />
              <span />
              <span />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="roast-bar h-1" />
              <div className="text-[11px] text-muted-foreground">
                <span className="font-mono">
                  {status === "waiting"
                    ? `${specialistDoneCount}/4 specialists complete`
                    : "generateObject → ReportSchema"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SpecialistProgressPills({ doneCount }: { doneCount: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SPECIALIST_ORDER.map((cat, i) => {
        const meta = SPECIALIST_META[cat];
        const isDone = i < doneCount;
        return (
          <span
            key={cat}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
              isDone
                ? cn(meta.accentText, "bg-[color:var(--color)]/15")
                : "bg-muted text-muted-foreground",
            )}
            style={
              isDone
                ? ({
                    ["--color" as string]: `var(--${meta.accentVar})`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isDone ? meta.accentBg : "bg-muted-foreground/40",
              )}
            />
            {meta.shortLabel}
          </span>
        );
      })}
    </div>
  );
}

function SynthBack({ status, report, errorMessage, errorKind, onRetry }: SynthCardProps) {
  if (status === "error") {
    return <SynthErrorBack errorMessage={errorMessage} errorKind={errorKind} onRetry={onRetry} />;
  }
  if (!report) {
    // Defensive — status "success" implies report is present. If it ever
    // isn't, render a neutral placeholder instead of crashing.
    return (
      <Card className="min-h-[220px]">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Report unavailable.
        </CardContent>
      </Card>
    );
  }

  const topPriority = report.topPriority;

  return (
    <div className="flex flex-col gap-4">
      <Card className="ring-2 ring-primary/30">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Executive summary · {hostFor(report.url)}
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {report.findings.length} findings
            </span>
          </div>
          <CardTitle className="text-lg leading-snug">
            Roadmap is ready.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ExecutiveSummaryBody summary={report.executiveSummary} />
        </CardContent>
      </Card>

      {topPriority ? (
        <FindingCard finding={topPriority} emphasis />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No critical issues</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              All four specialists completed without flagging anything
              actionable against the catalog. This site is in good shape.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SynthErrorBack({
  errorMessage,
  errorKind,
  onRetry,
}: {
  errorMessage?: string;
  errorKind?: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="min-h-[220px] border-destructive/40 ring-1 ring-destructive/30">
      <CardHeader>
        <div className="text-xs uppercase tracking-wider text-destructive">
          Synthesis couldn&apos;t finalize
        </div>
        <CardTitle className="text-lg">
          The roadmap needs another pass.
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-foreground/90">
          Sonnet produced output that didn&apos;t validate against the schema,
          or the call timed out. Specialist findings are still available — see
          the lanes below.
        </p>
        {errorKind ? (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono">{errorKind}</span>
            {errorMessage ? (
              <>
                {" · "}
                <span className="font-mono">{truncate(errorMessage, 140)}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {onRetry ? (
          <div>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Retry analysis
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Sonnet emits the executive summary as prose with \n\n paragraph breaks
// and occasional **bold** phrases or `code` spans. We render those inline
// formats without pulling in a markdown parser — the output is tightly
// constrained by the ReportSchema, so a focused regex is enough.
function ExecutiveSummaryBody({ summary }: { summary: string }) {
  const paragraphs = summary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/90">
      {paragraphs.map((para, i) => (
        <p key={i}>{renderInlineMarkdown(para)}</p>
      ))}
    </div>
  );
}

// Handles **bold** and `code` inline. Order matters: code first so its
// contents aren't bolded. Plain text falls through unchanged.
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize into a flat sequence of {kind, value} then render.
  const tokens: { kind: "text" | "bold" | "code"; value: string }[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, m.index) });
    }
    if (m[2] !== undefined) tokens.push({ kind: "bold", value: m[2] });
    else if (m[4] !== undefined) tokens.push({ kind: "code", value: m[4] });
    cursor = regex.lastIndex;
  }
  if (cursor < text.length) tokens.push({ kind: "text", value: text.slice(cursor) });
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "text") nodes.push(t.value);
    else if (t.kind === "bold") nodes.push(<strong key={i} className="font-semibold text-foreground">{t.value}</strong>);
    else nodes.push(<code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{t.value}</code>);
  }
  return nodes;
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Re-export FindingCategory helpers from the barrel to avoid unused imports
export type { FindingCategory };
