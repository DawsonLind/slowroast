import pLimit from "p-limit";
import { fetchPsi, PsiError } from "@/lib/psi";
import { fetchHtml, parseHtmlForAssets, type ParsedAssets } from "@/lib/html";
import {
  extractBundleSlice,
  extractCacheSlice,
  extractCwvSlice,
  extractImageSlice,
} from "@/lib/data-slice";
import { runImageSpecialist } from "@/lib/agents/image";
import { runBundleSpecialist } from "@/lib/agents/bundle";
import { runCacheSpecialist } from "@/lib/agents/cache";
import { runCwvSpecialist } from "@/lib/agents/cwv";
import { runSynth, SynthFailedError, type SynthAttempt } from "@/lib/synth";
import { computeSlowroastScore } from "@/lib/scoring";
import type {
  Finding,
  FindingCategory,
  Report,
  Severity,
  SpecialistOutput,
} from "@/lib/schemas";
import type { ProgressEvent } from "@/lib/progress-events";

export type { SynthAttempt } from "@/lib/synth";

// Phase budgets. Independent hard caps — a slow PSI does NOT steal time from
// specialists. Route-level maxDuration adds a safety net above these.
//
// Synth budget history:
//   15s → 30s after vercel.com testing (Day 2). 30s held only because vercel.com
//   sits at the fast end of the distribution.
//   30s → 90s on 2026-04-19 after the 7-URL eval (evals/results.json) measured
//   the real distribution: median 32s, p75 41s, p90 65s, p95 70s, max 70s
//   (reddit.com). The 30s cap was timing out 58% of real-world runs. 90s
//   covers p95 with ~25% slack; complex sites (many findings → larger
//   structured output) are the cost driver.
const SPECIALIST_TIMEOUT_MS = 40_000;
const DEFAULT_SYNTH_TIMEOUT_MS = 90_000;

// Cap concurrent specialist execution. Discovered empirically: four specialists
// firing at once (each doing the two-call pattern — tool-loop + dedicated
// summary) bursts past Vercel AI Gateway rate limits and 429s a subset of
// calls. This is a pacer, not a retry layer. Architecture stays parallel
// (Promise.all fans out all four below); p-limit just gates when each
// specialist's callback starts executing. Trade-off: worst-case specialist
// phase wall clock is 2 × SPECIALIST_TIMEOUT_MS instead of 1 ×, which tightens
// margin against the 120s route cap but stays safe under typical load (p95
// specialist was 22.7s in baseline measurement — well under 40s).
const SPECIALIST_CONCURRENCY = 2;
const specialistLimit = pLimit(SPECIALIST_CONCURRENCY);

// Degradation marker: a specialist that timed out or threw returns this
// sentinel summary. The synth prompt keys off the "[specialist-failed]"
// prefix to exclude the lane and note the skip in executiveSummary. Keeps
// SpecialistOutputSchema pure (no error field) while letting one type flow
// through the whole pipeline.
const FAILURE_PREFIX = "[specialist-failed]";

const EMPTY_ASSETS: ParsedAssets = {
  images: [],
  scripts: [],
  preloads: [],
  stylesheets: [],
  title: null,
};

export type PipelineErrorKind =
  | "psi"
  | "all_specialists_failed"
  | "synth"
  | "aborted";

export class PipelineError extends Error {
  readonly kind: PipelineErrorKind;
  readonly cause?: unknown;
  // Present only for kind: "synth" when runSynth exhausted all attempts or
  // timed out mid-loop. Carries each attempt's raw Sonnet output + ZodError
  // issues so the eval harness can persist them for diagnosis.
  readonly synthAttempts?: SynthAttempt[];

  constructor(
    kind: PipelineErrorKind,
    message: string,
    cause?: unknown,
    synthAttempts?: SynthAttempt[],
  ) {
    super(message);
    this.name = "PipelineError";
    this.kind = kind;
    this.cause = cause;
    this.synthAttempts = synthAttempts;
  }
}

export interface PhaseTimings {
  // Wall-clock milliseconds for the PSI+HTML data-fetch phase (these two run
  // in parallel via Promise.all; the reported time is the phase duration,
  // i.e. max of the two, not the sum).
  psiMs: number;
  // Per-specialist wall-clock milliseconds as observed by wrapSpecialist.
  // Under SPECIALIST_CONCURRENCY=2 these overlap in pairs rather than all
  // four, so imageMs + bundleMs + cacheMs + cwvMs will exceed specialistPhaseMs.
  imageMs: number;
  bundleMs: number;
  cacheMs: number;
  cwvMs: number;
  // Wall-clock of the entire specialist phase (Promise.all on all four
  // wrapped specialist calls). With p-limit(2) this is ≈ 2× the typical
  // per-specialist time.
  specialistPhaseMs: number;
  // Wall-clock of the generateObject synth call.
  synthMs: number;
  // End-to-end runAnalysis wall-clock (includes tiny amounts of HTML parsing
  // and slice extraction between phases).
  totalMs: number;
}

export interface AnalysisResult {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
  phaseTimings: PhaseTimings;
  // Per-attempt history from runSynth. Always at least one entry. An eventual
  // success after retries still surfaces the intermediate failure payloads
  // so we can learn from transient misses.
  synthAttempts: SynthAttempt[];
}

export interface RunAnalysisOptions {
  signal?: AbortSignal;
  // Overrides fetchPsi's 60s default. The API route should OMIT this. Manual
  // harnesses (scripts/test-pipeline.ts, eval runs) may pass higher to capture
  // long-tail distributions without truncation, but the default already covers
  // observed p95 (~45s on the 7-URL eval).
  psiTimeoutMs?: number;
  // Overrides the 90s synth default. Mirrors psiTimeoutMs so eval harnesses
  // can tighten or loosen independently of the API route — the eval harness
  // currently runs with 150s to record the natural distribution without
  // truncation.
  synthTimeoutMs?: number;
  // Optional progress sink. The API route uses this to forward lifecycle
  // events over NDJSON to the browser so the loading UI reflects real work
  // instead of a hardcoded client-side timer. Non-route callers (eval harness,
  // scripts/test-pipeline.ts) leave it unset and the emits are no-ops.
  onEvent?: (event: ProgressEvent) => void;
}

export async function runAnalysis(
  url: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisResult> {
  throwIfAborted(opts.signal);

  const emit = opts.onEvent ?? (() => {});
  const totalStartedAt = Date.now();

  // Phase 1: deterministic data collection. PSI enforces its own 60s cap;
  // fetchHtml is 10s. Both accept AbortSignal so caller disconnects win.
  // Each fetch gets its own timing/emit so the UI can light up the HTML card
  // independently of the slower PSI call.
  const psiStartedAt = Date.now();
  emit({ type: "phase", phase: "psi", status: "start" });
  emit({ type: "phase", phase: "html", status: "start" });
  const psiPromise = fetchPsi(url, {
    signal: opts.signal,
    timeoutMs: opts.psiTimeoutMs,
  }).then(
    (r) => {
      emit({
        type: "phase",
        phase: "psi",
        status: "done",
        durationMs: Date.now() - psiStartedAt,
      });
      return r;
    },
  );
  const htmlStartedAt = psiStartedAt;
  const htmlPromise = fetchHtml(url, { signal: opts.signal }).then((r) => {
    emit({
      type: "phase",
      phase: "html",
      status: "done",
      durationMs: Date.now() - htmlStartedAt,
    });
    return r;
  });
  let psi, htmlResult;
  try {
    [psi, htmlResult] = await Promise.all([psiPromise, htmlPromise]);
  } catch (err) {
    if (err instanceof PsiError) {
      console.error(
        `[pipeline] psi phase failed after ${Date.now() - psiStartedAt}ms: ${err.kind}`,
      );
      throw new PipelineError("psi", `PSI failed (${err.kind}): ${err.message}`, err);
    }
    throw err;
  }
  const psiMs = Date.now() - psiStartedAt;
  console.error(`[pipeline] psi phase ok in ${psiMs}ms`);

  const assets = htmlResult.html ? parseHtmlForAssets(htmlResult.html) : EMPTY_ASSETS;
  throwIfAborted(opts.signal);

  // Phase 2: parallel specialist fan-out. Each specialist gets wrapped so its
  // rejection or timeout becomes a degraded SpecialistOutput — the whole
  // report should not fail because one lane crashed. The existing specialists
  // don't accept an AbortSignal, so we enforce the phase cap via Promise.race.
  const imageSlice = extractImageSlice(psi, htmlResult, assets);
  const bundleSlice = extractBundleSlice(psi, htmlResult, assets);
  const cacheSlice = extractCacheSlice(psi, htmlResult);
  const cwvSlice = extractCwvSlice(psi, htmlResult, assets);

  // Emit "queued" for all four the moment we hand them to p-limit. Two will
  // flip to "running" immediately (p-limit(2)); the other two sit queued for
  // a beat, which the UI shows honestly instead of pretending all four
  // started at once.
  for (const cat of ["image", "bundle", "cache", "cwv"] as const) {
    emit({ type: "specialist", category: cat, status: "queued" });
  }

  const specialistPhaseStartedAt = Date.now();
  const wrapped = await Promise.all([
    specialistLimit(() =>
      wrapSpecialist("image", () => runImageSpecialist(imageSlice), emit),
    ),
    specialistLimit(() =>
      wrapSpecialist("bundle", () => runBundleSpecialist(bundleSlice), emit),
    ),
    specialistLimit(() =>
      wrapSpecialist("cache", () => runCacheSpecialist(cacheSlice), emit),
    ),
    specialistLimit(() =>
      wrapSpecialist("cwv", () => runCwvSpecialist(cwvSlice), emit),
    ),
  ]);
  const specialistPhaseMs = Date.now() - specialistPhaseStartedAt;
  const outputs = wrapped.map((w) => w.output);
  const specialistMsByCategory: Record<FindingCategory, number> = {
    image: 0,
    bundle: 0,
    cache: 0,
    cwv: 0,
  };
  for (const w of wrapped) specialistMsByCategory[w.output.specialist] = w.elapsedMs;

  const degradedSpecialists = outputs
    .filter((o) => o.summary.startsWith(FAILURE_PREFIX))
    .map((o) => o.specialist);

  if (degradedSpecialists.length === outputs.length) {
    throw new PipelineError(
      "all_specialists_failed",
      "all four specialists failed; no report to synthesize",
    );
  }

  throwIfAborted(opts.signal);

  // Phase 3: synthesis. Compose caller signal with a per-phase timeout so
  // either cancels cleanly. AbortSignal.any is in Node 20+ (Vercel default).
  const synthTimeoutMs = opts.synthTimeoutMs ?? DEFAULT_SYNTH_TIMEOUT_MS;
  const synthController = new AbortController();
  const synthTimer = setTimeout(() => synthController.abort(), synthTimeoutMs);
  const synthSignal = opts.signal
    ? AbortSignal.any([opts.signal, synthController.signal])
    : synthController.signal;

  // Compute the curved Slowroast score from the raw PSI performance score.
  // Passed into runSynth so Sonnet frames the executive summary around it
  // rather than the harsher PSI figure, and stamped onto the Report below so
  // the UI can render a grade badge without re-deriving.
  const slowroastScore = computeSlowroastScore(
    psi.categories.performance.score,
  );

  const synthStartedAt = Date.now();
  emit({ type: "synth", status: "start" });
  let synthResult;
  try {
    synthResult = await runSynth(url, outputs, {
      signal: synthSignal,
      slowroastScore: slowroastScore ?? undefined,
    });
  } catch (err) {
    const synthElapsed = Date.now() - synthStartedAt;
    // SynthFailedError carries the per-attempt history. Whether we got here
    // via exhausted retries, abort, or non-schema error, the attempts array
    // is what downstream diagnosis actually needs.
    const attempts =
      err instanceof SynthFailedError ? err.attempts : undefined;
    if (synthController.signal.aborted) {
      console.error(
        `[pipeline] synth phase timed out after ${synthElapsed}ms (cap=${synthTimeoutMs}ms, attempts=${attempts?.length ?? 0})`,
      );
      throw new PipelineError(
        "synth",
        `synthesis timed out after ${synthTimeoutMs}ms`,
        err,
        attempts,
      );
    }
    if (opts.signal?.aborted) {
      throw new PipelineError(
        "aborted",
        "analysis aborted by caller",
        err,
        attempts,
      );
    }
    console.error(
      `[pipeline] synth phase failed after ${synthElapsed}ms (attempts=${attempts?.length ?? 0}): ${errorMessage(err)}`,
    );
    throw new PipelineError(
      "synth",
      `synthesis failed: ${errorMessage(err)}`,
      err,
      attempts,
    );
  } finally {
    clearTimeout(synthTimer);
  }
  const synthOutput = synthResult.output;
  const synthAttempts = synthResult.attempts;
  const synthMs = Date.now() - synthStartedAt;
  emit({ type: "synth", status: "done", durationMs: synthMs });
  const retryCount = synthAttempts.length - 1;
  console.error(
    `[pipeline] synth phase ok in ${synthMs}ms (attempts=${synthAttempts.length}${retryCount > 0 ? `, recovered-from-${retryCount}-failures` : ""})`,
  );

  const report: Report = {
    url: psi.finalUrl,
    generatedAt: new Date().toISOString(),
    executiveSummary: synthOutput.executiveSummary,
    slowroastScore: slowroastScore ?? undefined,
    topPriority: synthOutput.topPriority,
    findings: synthOutput.findings,
    relatedFindings: synthOutput.relatedFindings,
  };

  const phaseTimings: PhaseTimings = {
    psiMs,
    imageMs: specialistMsByCategory.image,
    bundleMs: specialistMsByCategory.bundle,
    cacheMs: specialistMsByCategory.cache,
    cwvMs: specialistMsByCategory.cwv,
    specialistPhaseMs,
    synthMs,
    totalMs: Date.now() - totalStartedAt,
  };

  return {
    report,
    degradedSpecialists,
    htmlBlocked: htmlResult.blocked,
    phaseTimings,
    synthAttempts,
  };
}

// Wraps a specialist's run function with a per-call timeout. On timeout or
// error, returns a SpecialistOutput whose summary begins with FAILURE_PREFIX
// — the synth prompt knows to skip it. We intentionally DO NOT re-throw:
// keeping the per-lane failure local is what makes "partial failures don't
// fail the whole report" mechanical, not advisory.
// Also returns the observed wall clock so the caller can surface per-lane
// timings in phaseTimings.
interface WrappedSpecialist {
  output: SpecialistOutput;
  elapsedMs: number;
}

async function wrapSpecialist(
  category: FindingCategory,
  run: () => Promise<SpecialistOutput>,
  emit: (event: ProgressEvent) => void,
): Promise<WrappedSpecialist> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`specialist timeout after ${SPECIALIST_TIMEOUT_MS}ms`));
    }, SPECIALIST_TIMEOUT_MS);
  });

  const startedAt = Date.now();
  emit({ type: "specialist", category, status: "running" });
  try {
    const result = await Promise.race([run(), timeout]);
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[pipeline] ${category} specialist ok in ${elapsedMs}ms`,
    );
    emit({
      type: "specialist",
      category,
      status: "done",
      durationMs: elapsedMs,
      findingsCount: result.findings.length,
      topSeverity: worstSeverity(result.findings),
    });
    return { output: result, elapsedMs };
  } catch (err) {
    const reason = errorMessage(err);
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[pipeline] ${category} specialist failed after ${elapsedMs}ms; degrading lane: ${reason}`,
    );
    emit({
      type: "specialist",
      category,
      status: "failed",
      durationMs: elapsedMs,
    });
    return {
      output: {
        specialist: category,
        findings: [],
        summary: `${FAILURE_PREFIX} ${reason}`,
      },
      elapsedMs,
    };
  } finally {
    if (timer != null) clearTimeout(timer);
  }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PipelineError("aborted", "analysis aborted by caller", signal.reason);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
