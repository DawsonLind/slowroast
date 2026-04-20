"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
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
import { FindingCategorySchema, ReportSchema } from "@/lib/schemas";
import type { PhaseTimings } from "@/lib/pipeline";
import {
  ProgressEventSchema,
  type ProgressEvent,
} from "@/lib/progress-events";
import { SPECIALIST_META, SPECIALIST_ORDER } from "@/lib/ui-meta";
import { UrlForm } from "./url-form";
import { SpecialistGrid, type SpecialistViewState } from "./specialist-grid";
import { SynthCard, type SynthStatus } from "./synth-card";
import { PsiCard } from "./psi-card";
import { FindingsList } from "./findings-list";

// Zod shape for the "result" event payload. Kept local because it's only
// used at this one boundary — no reason to publicly export it.
const ResultPayloadSchema = z.object({
  report: ReportSchema,
  degradedSpecialists: z.array(FindingCategorySchema),
  htmlBlocked: z.boolean(),
  phaseTimings: z.object({
    psiMs: z.number(),
    imageMs: z.number(),
    bundleMs: z.number(),
    cacheMs: z.number(),
    cwvMs: z.number(),
    specialistPhaseMs: z.number(),
    synthMs: z.number(),
    totalMs: z.number(),
  }),
});

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

// Per-specialist state reflected from the streamed lifecycle events. The UI
// reads startedAt/completedAt to show real elapsed time, rather than
// extrapolating from a global client-side ticker.
interface SpecialistRuntime {
  status: "pending" | "queued" | "running" | "done" | "failed";
  startedAt?: number;
  completedAt?: number;
  findingsCount?: number;
  topSeverity?: Severity;
}

type SpecialistRuntimeMap = Record<FindingCategory, SpecialistRuntime>;

type PhaseStatus = "pending" | "running" | "done";

interface PhaseRuntime {
  psi: PhaseStatus;
  html: PhaseStatus;
}

type AnalyzeState =
  | { kind: "idle" }
  | {
      kind: "analyzing";
      startedAt: number;
      specialists: SpecialistRuntimeMap;
      phases: PhaseRuntime;
      synthStatus: "waiting" | "synthesizing";
    }
  | {
      kind: "success";
      data: SuccessResponse;
      specialists: SpecialistRuntimeMap;
    }
  | {
      kind: "error";
      status: number;
      error: string;
      message?: string;
      specialists?: SpecialistRuntimeMap;
    };

function initSpecialists(): SpecialistRuntimeMap {
  return {
    image: { status: "pending" },
    bundle: { status: "pending" },
    cache: { status: "pending" },
    cwv: { status: "pending" },
  };
}

export function Analyzer() {
  const [url, setUrl] = useState("https://vercel.com");
  const [state, setState] = useState<AnalyzeState>({ kind: "idle" });
  // Tick for elapsed-counter animation. Real per-specialist start/end
  // timestamps are authoritative — this just triggers re-renders so the
  // seconds counter advances while a card is running.
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
    setState({
      kind: "analyzing",
      startedAt: Date.now(),
      specialists: initSpecialists(),
      phases: { psi: "pending", html: "pending" },
      synthStatus: "waiting",
    });

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

      if (!res.body) {
        setState({
          kind: "error",
          status: 0,
          error: "network",
          message: "Response body is empty.",
        });
        return;
      }

      await consumeStream(res.body, (event) =>
        setState((prev) => reduceEvent(prev, event)),
      );
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

  const totalElapsedMs =
    state.kind === "analyzing" ? Date.now() - state.startedAt : 0;

  const specialistStates = computeSpecialistStates(state);
  const synthStatus = computeSynthStatus(state);
  const synthProps = buildSynthProps(state, totalElapsedMs, specialistStates);

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
          {state.kind === "analyzing" && state.phases.psi !== "done" ? (
            <PsiCard
              psiStatus={state.phases.psi}
              htmlStatus={state.phases.html}
              elapsedMs={totalElapsedMs}
            />
          ) : null}
          <SpecialistGrid
            states={specialistStates}
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
            excludeFinding={state.data.report.topPriority}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NDJSON stream consumption
// ---------------------------------------------------------------------------

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProgressEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      // Flush any trailing partial line. The server always writes a newline
      // after each event, but be defensive in case a proxy strips the final
      // one.
      if (buffer.trim().length > 0) dispatchLine(buffer, onEvent);
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      dispatchLine(line, onEvent);
    }
  }
}

function dispatchLine(line: string, onEvent: (event: ProgressEvent) => void) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    console.warn("[analyzer] skipped non-JSON stream line", trimmed);
    return;
  }
  const parsed = ProgressEventSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[analyzer] invalid progress event", parsed.error.issues);
    return;
  }
  onEvent(parsed.data);
}

// ---------------------------------------------------------------------------
// Event reducer — converts a streamed event into a new AnalyzeState
// ---------------------------------------------------------------------------

function reduceEvent(prev: AnalyzeState, event: ProgressEvent): AnalyzeState {
  // Events arriving after terminal states (success/error) are dropped — the
  // server closes the stream after "result" or "error", but a late event
  // shouldn't corrupt UI.
  if (prev.kind !== "analyzing") return prev;

  if (event.type === "phase") {
    const next: PhaseRuntime = { ...prev.phases };
    next[event.phase] = event.status === "start" ? "running" : "done";
    return { ...prev, phases: next };
  }

  if (event.type === "specialist") {
    const nextSpecs: SpecialistRuntimeMap = { ...prev.specialists };
    const current = nextSpecs[event.category];
    if (event.status === "queued") {
      nextSpecs[event.category] = { ...current, status: "queued" };
    } else if (event.status === "running") {
      nextSpecs[event.category] = {
        ...current,
        status: "running",
        startedAt: Date.now(),
      };
    } else if (event.status === "done") {
      nextSpecs[event.category] = {
        ...current,
        status: "done",
        completedAt: Date.now(),
        findingsCount: event.findingsCount,
        topSeverity: event.topSeverity,
      };
    } else {
      nextSpecs[event.category] = {
        ...current,
        status: "failed",
        completedAt: Date.now(),
      };
    }
    return { ...prev, specialists: nextSpecs };
  }

  if (event.type === "synth") {
    // "done" flips to "success" via the "result" event that follows immediately
    // after; we keep synthStatus as "synthesizing" in the meantime so the card
    // never briefly regresses.
    if (event.status === "start") {
      return { ...prev, synthStatus: "synthesizing" };
    }
    return prev;
  }

  if (event.type === "result") {
    // Validate the result payload shape on the client before committing it
    // to state. The inner Report was already schema-validated server-side
    // (generateObject + coerceSynthOutput), but client-side re-validation
    // protects against any wire-format drift or MITM rewrite.
    const raw = event.result;
    const parsed = ResultPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        "[analyzer] result payload failed schema validation",
        parsed.error.issues,
      );
      return {
        kind: "error",
        status: 0,
        error: "invalid_result",
        message: "Server returned a result that didn't match the expected shape.",
        specialists: prev.specialists,
      };
    }
    return {
      kind: "success",
      data: parsed.data,
      specialists: prev.specialists,
    };
  }

  // event.type === "error"
  return {
    kind: "error",
    status: 0,
    error: event.kind,
    message: event.message,
    specialists: prev.specialists,
  };
}

// ---------------------------------------------------------------------------
// View-state derivation — maps the runtime event log into SpecialistViewState
// that the grid expects.
// ---------------------------------------------------------------------------

function computeSpecialistStates(
  state: AnalyzeState,
): Record<FindingCategory, SpecialistViewState> {
  if (state.kind === "idle") {
    return fillStates({ status: "idle" });
  }

  // Success path: prefer report-derived counts/severities over the runtime
  // map because the synth can drop findings via its 10-cap. Fall back to the
  // runtime map for timing info.
  if (state.kind === "success") {
    const { report, degradedSpecialists } = state.data;
    const degraded = new Set(degradedSpecialists);
    const byCat = groupByCategory(report.findings);
    const out = {} as Record<FindingCategory, SpecialistViewState>;
    for (const cat of SPECIALIST_ORDER) {
      const runtime = state.specialists[cat];
      if (degraded.has(cat)) {
        out[cat] = {
          status: "error",
          startedAt: runtime.startedAt,
          completedAt: runtime.completedAt,
        };
        continue;
      }
      const items = byCat.get(cat) ?? [];
      out[cat] = {
        status: "done",
        findingsCount: items.length,
        topSeverity: worstSeverity(items),
        startedAt: runtime.startedAt,
        completedAt: runtime.completedAt,
      };
    }
    return out;
  }

  if (state.kind === "error") {
    // Preserve whatever runtime state we had — showing partial progress on
    // error beats collapsing everything back to idle.
    const out = {} as Record<FindingCategory, SpecialistViewState>;
    for (const cat of SPECIALIST_ORDER) {
      out[cat] = runtimeToView(state.specialists?.[cat]);
    }
    return out;
  }

  // Analyzing
  const out = {} as Record<FindingCategory, SpecialistViewState>;
  for (const cat of SPECIALIST_ORDER) {
    out[cat] = runtimeToView(state.specialists[cat]);
  }
  return out;
}

function runtimeToView(r?: SpecialistRuntime): SpecialistViewState {
  if (!r || r.status === "pending") return { status: "idle" };
  if (r.status === "queued") {
    return { status: "queued" };
  }
  if (r.status === "running") {
    return { status: "working", startedAt: r.startedAt };
  }
  if (r.status === "failed") {
    return {
      status: "error",
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    };
  }
  // done
  return {
    status: "done",
    findingsCount: r.findingsCount,
    topSeverity: r.topSeverity,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

function computeSynthStatus(state: AnalyzeState): SynthStatus {
  if (state.kind === "idle") return "waiting";
  if (state.kind === "success") return "success";
  if (state.kind === "error") return "error";
  return state.synthStatus;
}

function buildSynthProps(
  state: AnalyzeState,
  elapsedMs: number,
  specialistStates: Record<FindingCategory, SpecialistViewState>,
) {
  const doneCount = SPECIALIST_ORDER.filter(
    (c) => specialistStates[c].status === "done",
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
  invalid_result:
    "Server returned a response that didn't match the expected shape. Usually transient — retry.",
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
