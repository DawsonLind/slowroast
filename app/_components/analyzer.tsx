"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Finding,
  FindingCategory,
  Report,
  Severity,
} from "@/lib/schemas";
import type { PhaseTimings } from "@/lib/pipeline";
import {
  SPECIALIST_DONE_AT_MS,
  SPECIALIST_META,
  SPECIALIST_ORDER,
  SYNTH_START_AT_MS,
} from "@/lib/ui-meta";
import { UrlForm } from "./url-form";
import { SpecialistGrid, type SpecialistViewState } from "./specialist-grid";
import { SynthCard, type SynthStatus } from "./synth-card";
import { FindingsList } from "./findings-list";

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
  | { kind: "analyzing"; startedAt: number }
  | { kind: "success"; data: SuccessResponse }
  | {
      kind: "error";
      status: number;
      error: string;
      message?: string;
      // Partial-success error: synth failed but specialist findings may still
      // be present in the response body. API currently doesn't surface these
      // on a PipelineError, but the shape is here if we wire it later.
      partial?: SuccessResponse;
    };

export function Analyzer() {
  const [url, setUrl] = useState("https://vercel.com");
  const [state, setState] = useState<AnalyzeState>({ kind: "idle" });
  // Tick for elapsed-counter + progression animations. 400ms is smooth
  // enough for the pulse-driven UI without burning renders.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (state.kind !== "analyzing") return;
    const id = setInterval(() => forceTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [state.kind]);

  const abortRef = useRef<AbortController | null>(null);
  const lastSubmitRef = useRef<React.FormEvent | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    lastSubmitRef.current = e;
    if (state.kind === "analyzing") return;

    const trimmed = url.trim();
    const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState({ kind: "analyzing", startedAt: Date.now() });

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

  function retry() {
    const e = lastSubmitRef.current;
    if (e) void submit(e);
  }

  const scrollToCategory = (cat: FindingCategory) => {
    const el = document.getElementById(`findings-${cat}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Derived view state based on analysis phase.
  const elapsedMs =
    state.kind === "analyzing" ? Date.now() - state.startedAt : 0;

  const specialistStates = computeSpecialistStates(state, elapsedMs);
  const synthStatus = computeSynthStatus(state, elapsedMs);
  const synthProps = buildSynthProps(state, elapsedMs, specialistStates);

  const isAnalyzing = state.kind === "analyzing";
  const isError = state.kind === "error";
  const canReset = state.kind === "success" || state.kind === "error";

  return (
    <div className="flex flex-col gap-6">
      <UrlForm
        url={url}
        onUrlChange={setUrl}
        onSubmit={submit}
        onReset={reset}
        canReset={canReset}
        isLoading={isAnalyzing}
      />

      {isError ? (
        <ErrorBanner
          state={state as Extract<AnalyzeState, { kind: "error" }>}
          onRetry={retry}
        />
      ) : null}

      {state.kind === "success" ? (
        <ReportBanners
          degradedSpecialists={state.data.degradedSpecialists}
          htmlBlocked={state.data.htmlBlocked}
        />
      ) : null}

      {state.kind !== "idle" ? (
        <>
          <SpecialistGrid
            states={specialistStates}
            elapsedMs={elapsedMs}
            onCardClick={scrollToCategory}
          />
          <SynthCard {...synthProps} status={synthStatus} />
        </>
      ) : (
        <IdlePanel />
      )}

      {state.kind === "success" ? (
        <>
          <TimingFootnote phaseTimings={state.data.phaseTimings} />
          <FindingsList
            findings={state.data.report.findings}
            degradedSpecialists={state.data.degradedSpecialists}
            excludeFindingId={state.data.report.topPriority?.id}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View-state derivation — this is where the "theater" timing meets real
// API state. Pre-response we drive specialist progression from observed
// eval timings; post-response we snap to reality.
// ---------------------------------------------------------------------------

function computeSpecialistStates(
  state: AnalyzeState,
  elapsedMs: number,
): Record<FindingCategory, SpecialistViewState> {
  if (state.kind === "idle") {
    return fillStates({ status: "idle" });
  }

  if (state.kind === "analyzing") {
    const out = {} as Record<FindingCategory, SpecialistViewState>;
    for (const cat of SPECIALIST_ORDER) {
      const doneAt = SPECIALIST_DONE_AT_MS[cat];
      if (elapsedMs < doneAt - 4000) {
        out[cat] = { status: "working" };
      } else if (elapsedMs < doneAt) {
        out[cat] = { status: "near-done" };
      } else {
        // Until the real response lands, show "near-done" (not "done") —
        // we don't yet have the true findings count. This avoids lying
        // about results before the server says so.
        out[cat] = { status: "near-done" };
      }
    }
    return out;
  }

  if (state.kind === "success") {
    const { report, degradedSpecialists } = state.data;
    const degraded = new Set(degradedSpecialists);
    const byCat = groupByCategory(report.findings);
    const out = {} as Record<FindingCategory, SpecialistViewState>;
    for (const cat of SPECIALIST_ORDER) {
      if (degraded.has(cat)) {
        out[cat] = { status: "error" };
        continue;
      }
      const items = byCat.get(cat) ?? [];
      out[cat] = {
        status: "done",
        findingsCount: items.length,
        topSeverity: worstSeverity(items),
      };
    }
    return out;
  }

  // Error — specialists we know failed show as error; the rest collapse to
  // idle so the grid doesn't look like it succeeded.
  return fillStates({ status: "error" });
}

function computeSynthStatus(state: AnalyzeState, elapsedMs: number): SynthStatus {
  if (state.kind === "idle") return "waiting";
  if (state.kind === "analyzing") {
    return elapsedMs < SYNTH_START_AT_MS ? "waiting" : "synthesizing";
  }
  if (state.kind === "success") return "success";
  return "error";
}

function buildSynthProps(
  state: AnalyzeState,
  elapsedMs: number,
  specialistStates: Record<FindingCategory, SpecialistViewState>,
) {
  const doneCount = SPECIALIST_ORDER.filter(
    (c) =>
      specialistStates[c].status === "done" ||
      specialistStates[c].status === "near-done",
  ).length;

  if (state.kind === "success") {
    return {
      elapsedMs,
      specialistDoneCount: 4,
      report: state.data.report,
    };
  }
  if (state.kind === "error") {
    return {
      elapsedMs,
      specialistDoneCount: doneCount,
      errorMessage: state.message,
      errorKind: state.error,
    };
  }
  return {
    elapsedMs,
    specialistDoneCount: doneCount,
  };
}

function fillStates(
  s: SpecialistViewState,
): Record<FindingCategory, SpecialistViewState> {
  return {
    image: s,
    bundle: s,
    cache: s,
    cwv: s,
  };
}

function groupByCategory(findings: Finding[]): Map<FindingCategory, Finding[]> {
  const out = new Map<FindingCategory, Finding[]>();
  for (const f of findings) {
    const b = out.get(f.category) ?? [];
    b.push(f);
    out.set(f.category, b);
  }
  return out;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  opportunity: 0,
};

function worstSeverity(items: Finding[]): Severity | undefined {
  if (items.length === 0) return undefined;
  let worst: Severity = items[0].severity;
  for (const f of items) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) worst = f.severity;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function IdlePanel() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" aria-hidden />
          <span className="font-medium text-foreground">How it works</span>
        </div>
        <p className="leading-relaxed">
          Paste any public URL. We fetch PageSpeed Insights + raw HTML in
          parallel, fan out to four specialist{" "}
          <code className="font-mono text-foreground/80">ToolLoopAgent</code>s
          (image, bundle, cache, CWV), then a Sonnet synthesizer ranks their
          findings by impact × ease — every recommendation grounded in a
          curated Vercel feature catalog.
        </p>
        <p className="text-xs">
          Typical run: ~75 seconds end-to-end.
        </p>
      </CardContent>
    </Card>
  );
}

const ERROR_HINTS: Record<string, string> = {
  psi:
    "Upstream PageSpeed Insights call failed. Try again in a moment, or try a different URL — rate limits and transient 5xx are both common.",
  synth:
    "The synthesizer exceeded its budget or produced output that didn't validate. Retrying often works; Sonnet has real variance on structured output under the catalog-enum constraint.",
  all_specialists_failed:
    "All four specialists failed — most commonly a Gateway rate-limit spike. Retrying in a few seconds usually resolves this.",
  invalid_body:
    "The URL didn't pass validation. Make sure it starts with https:// and is well-formed.",
  network:
    "The browser couldn't reach the server. Check your connection and retry.",
  aborted: "Request was cancelled.",
};

function ErrorBanner({
  state,
  onRetry,
}: {
  state: Extract<AnalyzeState, { kind: "error" }>;
  onRetry: () => void;
}) {
  const hint = ERROR_HINTS[state.error];
  const isPsi = state.error === "psi";
  const isNetwork = state.error === "network";
  return (
    <Card className="border-destructive/40 bg-destructive/5 ring-1 ring-destructive/20">
      <CardContent className="flex flex-col gap-3 py-4 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          <span className="font-medium text-foreground">
            {isNetwork ? "Network error" : isPsi ? "Data source unavailable" : "Analysis failed"}
          </span>
          <Badge variant="destructive" className="font-mono text-[10px]">
            {state.error}
          </Badge>
        </div>
        {hint ? <p className="text-muted-foreground">{hint}</p> : null}
        {state.message ? (
          <p className="max-w-2xl font-mono text-[11px] text-muted-foreground/80">
            {state.message}
          </p>
        ) : null}
        <div>
          <Button type="button" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportBanners({
  degradedSpecialists,
  htmlBlocked,
}: {
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
}) {
  if (degradedSpecialists.length === 0 && !htmlBlocked) return null;
  return (
    <Card className="border-sev-high/40 bg-sev-high/5">
      <CardContent className="flex flex-col gap-2 py-3 text-sm">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-sev-high" aria-hidden />
          <span className="font-medium text-foreground">
            Degraded analysis
          </span>
        </div>
        {htmlBlocked ? (
          <p className="text-foreground/80">
            Direct HTML fetch was blocked (likely a WAF). Specialists worked
            from PSI data only; confidence may be reduced on findings that
            depend on raw markup.
          </p>
        ) : null}
        {degradedSpecialists.length > 0 ? (
          <p className="text-foreground/80">
            Degraded specialist{degradedSpecialists.length === 1 ? "" : "s"}:{" "}
            <span className="font-mono">
              {degradedSpecialists
                .map((s) => SPECIALIST_META[s].shortLabel)
                .join(", ")}
            </span>
            . Those lanes failed or partially completed — see their card for
            status.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TimingFootnote({ phaseTimings }: { phaseTimings: PhaseTimings }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/20 px-3 py-2",
        "flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground",
      )}
    >
      <span>PSI {fmt(phaseTimings.psiMs)}</span>
      <span className="opacity-40">·</span>
      <span>specialists {fmt(phaseTimings.specialistPhaseMs)}</span>
      <span className="opacity-40">·</span>
      <span>synth {fmt(phaseTimings.synthMs)}</span>
      <span className="opacity-40">·</span>
      <span>total {fmt(phaseTimings.totalMs)}</span>
    </div>
  );
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
