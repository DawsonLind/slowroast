"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getVercelFeatureById,
  type VercelFeatureId,
} from "@/lib/vercel-features";
import type {
  Finding,
  FindingCategory,
  Report,
  Severity,
} from "@/lib/schemas";
import type { PhaseTimings } from "@/lib/pipeline";

interface SuccessResponse {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
  phaseTimings: PhaseTimings;
}

interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}

type AnalyzeState =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "success"; data: SuccessResponse }
  | { kind: "error"; status: number; error: string; message?: string };

// Phase progression shown during loading. Not truly streamed — honest timing
// is what these ranges observed on vercel.com in Day 2 runs are. See
// lib/pipeline.ts phase budgets and docs/architecture.md §2.
const PHASE_WINDOWS: readonly {
  label: string;
  sublabel: string;
  untilMs: number;
}[] = [
  {
    label: "Fetching PageSpeed + HTML",
    sublabel: "Google runs Lighthouse in its own infra (~20–30s)",
    untilMs: 30_000,
  },
  {
    label: "Specialists analyzing",
    sublabel: "Four ToolLoopAgents in parallel (image, bundle, cache, CWV)",
    untilMs: 60_000,
  },
  {
    label: "Synthesizing prioritized report",
    sublabel: "generateObject with Sonnet 4.6 against a catalog-bound schema",
    untilMs: 120_000,
  },
];

function currentPhase(elapsedMs: number): {
  label: string;
  sublabel: string;
  index: number;
} {
  for (let i = 0; i < PHASE_WINDOWS.length; i++) {
    if (elapsedMs < PHASE_WINDOWS[i].untilMs) {
      return { ...PHASE_WINDOWS[i], index: i };
    }
  }
  const last = PHASE_WINDOWS[PHASE_WINDOWS.length - 1];
  return { ...last, index: PHASE_WINDOWS.length - 1 };
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-700 dark:text-red-300",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  opportunity: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  image: "Image",
  bundle: "Bundle",
  cache: "Cache & Delivery",
  cwv: "Core Web Vitals",
};

const CATEGORY_ORDER: readonly FindingCategory[] = [
  "image",
  "bundle",
  "cache",
  "cwv",
];

export function Analyzer() {
  const [url, setUrl] = useState("https://vercel.com");
  const [state, setState] = useState<AnalyzeState>({ kind: "idle" });

  // Tick every 500ms so the elapsed counter advances while loading.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (state.kind !== "loading") return;
    const id = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [state.kind]);

  const abortRef = useRef<AbortController | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "loading") return;

    // Normalize — allow the user to paste a bare domain.
    const trimmed = url.trim();
    const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({ kind: "loading", startedAt: Date.now() });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as ErrorResponse;
        setState({
          kind: "error",
          status: res.status,
          error: errBody.error ?? `http_${res.status}`,
          message: errBody.message,
        });
        return;
      }

      const data = (await res.json()) as SuccessResponse;
      setState({ kind: "success", data });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState({
        kind: "error",
        status: 0,
        error: "network",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    abortRef.current?.abort();
    setState({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="url">
          URL to analyze
        </label>
        <Input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={state.kind === "loading"}
          className="h-11 text-base sm:flex-1"
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="lg"
            disabled={state.kind === "loading" || url.trim() === ""}
            className="h-11 px-5"
          >
            {state.kind === "loading" ? "Analyzing…" : "Analyze"}
          </Button>
          {state.kind !== "idle" && state.kind !== "loading" ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={reset}
              className="h-11 px-4"
            >
              New URL
            </Button>
          ) : null}
        </div>
      </form>

      {state.kind === "loading" ? <LoadingPanel startedAt={state.startedAt} /> : null}
      {state.kind === "error" ? <ErrorPanel state={state} onRetry={submit} /> : null}
      {state.kind === "success" ? <ReportView data={state.data} /> : null}
    </div>
  );
}

function LoadingPanel({ startedAt }: { startedAt: number }) {
  const elapsedMs = Date.now() - startedAt;
  const phase = currentPhase(elapsedMs);
  const elapsedS = (elapsedMs / 1000).toFixed(0);
  return (
    <Card aria-live="polite" aria-busy="true">
      <CardHeader>
        <CardTitle>{phase.label}</CardTitle>
        <div className="text-sm text-muted-foreground">{phase.sublabel}</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {PHASE_WINDOWS.map((p, i) => (
            <span
              key={p.label}
              className={cn(
                "rounded-full px-2 py-0.5",
                i < phase.index
                  ? "bg-foreground/10 text-foreground/70"
                  : i === phase.index
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}. {p.label.split(" ")[0]}
            </span>
          ))}
          <span className="ml-auto tabular-nums">{elapsedS}s</span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 bg-foreground transition-[width] duration-500"
            style={{
              width: `${Math.min(95, (elapsedMs / 90_000) * 100)}%`,
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Typical run: ~75 seconds. Hard cap: 120 seconds.
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorPanel({
  state,
  onRetry,
}: {
  state: Extract<AnalyzeState, { kind: "error" }>;
  onRetry: (e: React.FormEvent) => void;
}) {
  const reasonHint = ERROR_HINTS[state.error] ?? undefined;
  return (
    <Card className="border-destructive/40 ring-1 ring-destructive/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Analysis failed
          <Badge variant="destructive">{state.error}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {state.message ? (
          <p className="font-mono text-xs text-muted-foreground">{state.message}</p>
        ) : null}
        {reasonHint ? <p className="text-muted-foreground">{reasonHint}</p> : null}
        <div>
          <Button type="button" onClick={onRetry} size="sm">
            Retry
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const ERROR_HINTS: Record<string, string> = {
  psi: "Upstream PageSpeed Insights call failed. Try again in a moment, or try a different URL — rate limits and transient 5xx are both common.",
  synth:
    "The synthesizer exceeded its 30s budget. This is usually variance in Sonnet's structured-output latency; retry generally works.",
  all_specialists_failed:
    "All four specialists failed — most commonly a Gateway rate limit spike. Retrying in a few seconds usually resolves this.",
  invalid_body: "The URL didn't pass validation. Make sure it starts with https:// and is well-formed.",
  network: "The browser couldn't reach the server. Check your connection and retry.",
};

function ReportView({ data }: { data: SuccessResponse }) {
  const { report, degradedSpecialists, htmlBlocked, phaseTimings } = data;
  const findingsByCategory = groupBy(report.findings, (f) => f.category);

  return (
    <div className="flex flex-col gap-6">
      {(htmlBlocked || degradedSpecialists.length > 0) && (
        <DegradedBanner
          htmlBlocked={htmlBlocked}
          degradedSpecialists={degradedSpecialists}
        />
      )}

      <Card>
        <CardHeader>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Executive summary
          </div>
          <CardTitle className="text-lg">{hostFor(report.url)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-foreground/90">
            {report.executiveSummary}
          </p>
          <TimingFootnote phaseTimings={phaseTimings} />
        </CardContent>
      </Card>

      {report.topPriority ? (
        <TopPriorityCard finding={report.topPriority} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No issues found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              All four specialists completed without flagging anything
              actionable against the catalog. That&apos;s a real, valid state
              — this site is in good shape.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          All findings{" "}
          <span className="font-normal normal-case text-muted-foreground">
            ({report.findings.length})
          </span>
        </h2>
        {report.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No additional findings beyond the top priority.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {CATEGORY_ORDER.map((category) => {
              const items = findingsByCategory.get(category) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={category} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">
                      {CATEGORY_LABEL[category]}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {items.length} finding{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {items.map((f) => (
                      <FindingCard key={f.id} finding={f} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function DegradedBanner({
  htmlBlocked,
  degradedSpecialists,
}: {
  htmlBlocked: boolean;
  degradedSpecialists: FindingCategory[];
}) {
  const parts: string[] = [];
  if (htmlBlocked) {
    parts.push(
      "Direct HTML fetch was blocked (likely a WAF). Specialists worked from PSI data only; confidence may be reduced.",
    );
  }
  if (degradedSpecialists.length > 0) {
    parts.push(
      `Degraded specialists: ${degradedSpecialists
        .map((s) => CATEGORY_LABEL[s])
        .join(", ")}. Their lane is missing from this report.`,
    );
  }
  return (
    <Card className="border-yellow-500/40 bg-yellow-500/5">
      <CardContent className="py-3 text-sm">
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => (
            <p key={i} className="text-foreground/80">
              {p}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopPriorityCard({ finding }: { finding: Finding }) {
  return (
    <Card className="ring-2 ring-foreground/80">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Top priority · {CATEGORY_LABEL[finding.category]}
          </div>
          <SeverityBadge severity={finding.severity} />
        </div>
        <CardTitle className="text-xl leading-snug">{finding.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FindingBody finding={finding} />
      </CardContent>
    </Card>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {CATEGORY_LABEL[finding.category]}
          </div>
          <SeverityBadge severity={finding.severity} />
        </div>
        <CardTitle>{finding.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FindingBody finding={finding} />
      </CardContent>
    </Card>
  );
}

function FindingBody({ finding }: { finding: Finding }) {
  const feature = getVercelFeatureById(finding.vercelFeatureId as VercelFeatureId);
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Evidence</dt>
        <dd className="leading-relaxed">{finding.evidence}</dd>
        <dt className="text-muted-foreground">Estimated impact</dt>
        <dd>{finding.estimatedImpact}</dd>
        <dt className="text-muted-foreground">Confidence</dt>
        <dd>
          <ConfidenceMeter value={finding.confidence} />
        </dd>
        {finding.affectedResources.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Affected resources</dt>
            <dd className="flex flex-col gap-1 font-mono text-xs">
              {finding.affectedResources.slice(0, 4).map((r, i) => (
                <span key={i} className="truncate" title={r}>
                  {r}
                </span>
              ))}
              {finding.affectedResources.length > 4 ? (
                <span className="text-muted-foreground">
                  + {finding.affectedResources.length - 4} more
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
      {feature ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Recommended Vercel feature
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{feature.title}</span>
            <a
              href={feature.vercelDocs}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Vercel docs ↗
            </a>
            <a
              href={feature.nextDocs}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Next.js docs ↗
            </a>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Unknown feature id <code>{finding.vercelFeatureId}</code> — not in
          catalog. This should not be possible if the synth schema was enforced.
        </div>
      )}
    </>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-foreground/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        SEVERITY_STYLES[severity],
      )}
    >
      {severity}
    </span>
  );
}

function TimingFootnote({ phaseTimings }: { phaseTimings: PhaseTimings }) {
  return (
    <div className="text-xs text-muted-foreground tabular-nums">
      PSI {fmt(phaseTimings.psiMs)} · specialists {fmt(phaseTimings.specialistPhaseMs)} ·
      synth {fmt(phaseTimings.synthMs)} · total {fmt(phaseTimings.totalMs)}
    </div>
  );
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k) ?? [];
    bucket.push(item);
    out.set(k, bucket);
  }
  return out;
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
