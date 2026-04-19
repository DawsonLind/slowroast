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
import { runSynth } from "@/lib/synth";
import type {
  FindingCategory,
  Report,
  SpecialistOutput,
} from "@/lib/schemas";

// Phase budgets. Independent hard caps — a slow PSI does NOT steal time from
// specialists. Route-level maxDuration = 120s adds a safety net above these.
// Synth budget was 15s originally; 3-of-3 test:pipeline runs against
// vercel.com showed Sonnet 4.6 blowing past 15s on the structured-output
// synth call (executiveSummary + up to 10 findings with strict catalog-enum
// vercelFeatureId + topPriority). 30s matches observed ceiling plus slack.
const SPECIALIST_TIMEOUT_MS = 40_000;
const DEFAULT_SYNTH_TIMEOUT_MS = 30_000;

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

  constructor(kind: PipelineErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "PipelineError";
    this.kind = kind;
    this.cause = cause;
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
}

export interface RunAnalysisOptions {
  signal?: AbortSignal;
  // Overrides fetchPsi's 30s default. The API route should OMIT this — a fast
  // PSI fail is the right UX there. Manual harnesses (scripts/test-pipeline.ts,
  // eval runs) should pass ~60s because PSI's wall clock varies meaningfully
  // on real sites and the documented arch doc range is 10–30s.
  psiTimeoutMs?: number;
  // Overrides the 30s synth default. Mirrors psiTimeoutMs so eval harnesses
  // can tighten or loosen independently of the API route. Once eval gives us
  // p95 synth data, we may shrink this below 30s for the route specifically.
  synthTimeoutMs?: number;
}

export async function runAnalysis(
  url: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisResult> {
  throwIfAborted(opts.signal);

  const totalStartedAt = Date.now();

  // Phase 1: deterministic data collection. PSI enforces its own 30s cap;
  // fetchHtml is 10s. Both accept AbortSignal so caller disconnects win.
  const psiStartedAt = Date.now();
  let psi, htmlResult;
  try {
    [psi, htmlResult] = await Promise.all([
      fetchPsi(url, { signal: opts.signal, timeoutMs: opts.psiTimeoutMs }),
      fetchHtml(url, { signal: opts.signal }),
    ]);
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

  const specialistPhaseStartedAt = Date.now();
  const wrapped = await Promise.all([
    specialistLimit(() => wrapSpecialist("image", () => runImageSpecialist(imageSlice))),
    specialistLimit(() => wrapSpecialist("bundle", () => runBundleSpecialist(bundleSlice))),
    specialistLimit(() => wrapSpecialist("cache", () => runCacheSpecialist(cacheSlice))),
    specialistLimit(() => wrapSpecialist("cwv", () => runCwvSpecialist(cwvSlice))),
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

  const synthStartedAt = Date.now();
  let synthOutput;
  try {
    synthOutput = await runSynth(url, outputs, { signal: synthSignal });
  } catch (err) {
    const synthElapsed = Date.now() - synthStartedAt;
    if (synthController.signal.aborted) {
      console.error(
        `[pipeline] synth phase timed out after ${synthElapsed}ms (cap=${synthTimeoutMs}ms)`,
      );
      throw new PipelineError(
        "synth",
        `synthesis timed out after ${synthTimeoutMs}ms`,
        err,
      );
    }
    if (opts.signal?.aborted) {
      throw new PipelineError("aborted", "analysis aborted by caller", err);
    }
    console.error(
      `[pipeline] synth phase failed after ${synthElapsed}ms: ${errorMessage(err)}`,
    );
    throw new PipelineError(
      "synth",
      `synthesis failed: ${errorMessage(err)}`,
      err,
    );
  } finally {
    clearTimeout(synthTimer);
  }
  const synthMs = Date.now() - synthStartedAt;
  console.error(`[pipeline] synth phase ok in ${synthMs}ms`);

  const report: Report = {
    url: psi.finalUrl,
    generatedAt: new Date().toISOString(),
    executiveSummary: synthOutput.executiveSummary,
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
): Promise<WrappedSpecialist> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`specialist timeout after ${SPECIALIST_TIMEOUT_MS}ms`));
    }, SPECIALIST_TIMEOUT_MS);
  });

  const startedAt = Date.now();
  try {
    const result = await Promise.race([run(), timeout]);
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[pipeline] ${category} specialist ok in ${elapsedMs}ms`,
    );
    return { output: result, elapsedMs };
  } catch (err) {
    const reason = errorMessage(err);
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[pipeline] ${category} specialist failed after ${elapsedMs}ms; degrading lane: ${reason}`,
    );
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PipelineError("aborted", "analysis aborted by caller", signal.reason);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
