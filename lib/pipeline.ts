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

// phase budgets. independent caps so a slow PSI cant silently rob specialists.
// route maxDuration sits above these as a safety net.
//
// synth budget history: started at 15s (day 2 vercel.com only), bumped to 30s,
// then 90s on 2026-04-19 after the 7-URL eval showed the real distribution -
// median 32s, p95 70s. the old 30s cap was killing 58% of real runs. complex
// sites with many findings drive the tail (bigger structured output)
const SPECIALIST_TIMEOUT_MS = 40_000;
const DEFAULT_SYNTH_TIMEOUT_MS = 90_000;

// cap concurrent specialists. learned the hard way - four at once (each doing
// two calls: tool-loop + summary) bursts past the Gateway rate limit and 429s
// a bunch of calls. this is a pacer not a retry layer. Promise.all still fans
// all four out, p-limit just gates when each callback starts. worst-case
// phase wall clock goes from 1x to 2x SPECIALIST_TIMEOUT_MS but thats still
// fine under the route cap
const SPECIALIST_CONCURRENCY = 2;
const specialistLimit = pLimit(SPECIALIST_CONCURRENCY);

// sentinel summary prefix for a degraded lane (timeout/throw). synth prompt
// keys off "[specialist-failed]" to skip the lane and name it in the exec
// summary. keeps SpecialistOutputSchema unchanged - one type flows through
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
  // only set for kind: "synth" when runSynth exhausted retries or timed out.
  // carries each attempt's raw sonnet output + zod issues so the eval harness
  // can save them for diagnosis later
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
  // wall-clock ms for PSI+HTML (they run in parallel, this is the max of
  // the two not the sum)
  psiMs: number;
  // per-specialist wall clock from wrapSpecialist. with concurrency=2 the
  // four overlap in pairs so their sum exceeds specialistPhaseMs
  imageMs: number;
  bundleMs: number;
  cacheMs: number;
  cwvMs: number;
  // wall-clock across all four wrapped specialist calls (Promise.all). with
  // p-limit(2) this lands around 2x the typical per-specialist time
  specialistPhaseMs: number;
  // wall-clock of the generateObject synth call
  synthMs: number;
  // end-to-end runAnalysis wall-clock. includes the small bits of HTML
  // parsing and slice extraction between phases
  totalMs: number;
}

export interface AnalysisResult {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
  phaseTimings: PhaseTimings;
  // per-attempt history from runSynth, always at least one entry. a success
  // after retries still surfaces the intermediate failures so we can look
  // back at transient misses
  synthAttempts: SynthAttempt[];
}

export interface RunAnalysisOptions {
  signal?: AbortSignal;
  // overrides fetchPsi's 60s default. the API route should leave this unset.
  // manual harnesses (test-pipeline, eval) can pass higher to capture the
  // long tail without truncation
  psiTimeoutMs?: number;
  // overrides the 90s synth default. same idea as psiTimeoutMs - the eval
  // harness currently runs with 150s to record the natural distribution
  synthTimeoutMs?: number;
  // optional progress sink. the API route forwards lifecycle events over
  // NDJSON to the browser so the loading UI reflects real work instead of
  // a hardcoded ticker. non-route callers leave it unset and the emits are
  // no-ops
  onEvent?: (event: ProgressEvent) => void;
}

export async function runAnalysis(
  url: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisResult> {
  throwIfAborted(opts.signal);

  const emit = opts.onEvent ?? (() => {});
  const totalStartedAt = Date.now();

  // phase 1: deterministic data collection. PSI has its own 60s cap,
  // fetchHtml is 10s. both honor AbortSignal so caller disconnects win
  // immediately. each fetch emits its own lifecycle events so the UI can
  // light up the HTML side without waiting on the slower PSI call.
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

  // phase 2: specialists fan out in parallel. each one is wrapped so a
  // rejection or timeout turns into a degraded SpecialistOutput - one bad
  // lane should never kill the whole report. specialists dont accept an
  // AbortSignal themselves, so the phase cap is enforced via Promise.race
  // inside wrapSpecialist below.
  const imageSlice = extractImageSlice(psi, htmlResult, assets);
  const bundleSlice = extractBundleSlice(psi, htmlResult, assets);
  const cacheSlice = extractCacheSlice(psi, htmlResult);
  const cwvSlice = extractCwvSlice(psi, htmlResult, assets);

  // emit "queued" for all four as they go into p-limit. two flip to "running"
  // immediately, the other two sit queued for a beat - the UI shows this
  // honestly instead of pretending all four started at once
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

  // phase 3: synth. compose the caller signal with a phase timeout so either
  // can cancel cleanly (AbortSignal.any needs node 20+, vercel default)
  const synthTimeoutMs = opts.synthTimeoutMs ?? DEFAULT_SYNTH_TIMEOUT_MS;
  const synthController = new AbortController();
  const synthTimer = setTimeout(() => synthController.abort(), synthTimeoutMs);
  const synthSignal = opts.signal
    ? AbortSignal.any([opts.signal, synthController.signal])
    : synthController.signal;

  // curve the raw PSI perf score into the slowroast score. passed to runSynth
  // so sonnet uses it in the exec summary, and stamped on the report below so
  // the UI can render a grade badge without recomputing
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
    // SynthFailedError carries the attempt history. however we got here
    // (exhausted retries, abort, non-schema error) the attempts array is
    // what downstream diagnosis actually needs
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

// wraps a specialist's run fn with a per-call timeout. on timeout or error
// it returns a SpecialistOutput whose summary starts with FAILURE_PREFIX,
// which the synth prompt knows to skip. deliberately does NOT re-throw -
// keeping the failure local is what makes "partial failures dont kill the
// report" mechanical not advisory. also returns elapsed ms for phaseTimings
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
