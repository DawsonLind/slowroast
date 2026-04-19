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
// specialists. Route-level maxDuration = 90s adds a safety net above these.
const SPECIALIST_TIMEOUT_MS = 40_000;
const SYNTH_TIMEOUT_MS = 15_000;

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

export interface AnalysisResult {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
}

export interface RunAnalysisOptions {
  signal?: AbortSignal;
}

export async function runAnalysis(
  url: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisResult> {
  throwIfAborted(opts.signal);

  // Phase 1: deterministic data collection. PSI enforces its own 30s cap;
  // fetchHtml is 10s. Both accept AbortSignal so caller disconnects win.
  let psi, htmlResult;
  try {
    [psi, htmlResult] = await Promise.all([
      fetchPsi(url, { signal: opts.signal }),
      fetchHtml(url, { signal: opts.signal }),
    ]);
  } catch (err) {
    if (err instanceof PsiError) {
      throw new PipelineError("psi", `PSI failed (${err.kind}): ${err.message}`, err);
    }
    throw err;
  }

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

  const outputs = await Promise.all([
    wrapSpecialist("image", () => runImageSpecialist(imageSlice)),
    wrapSpecialist("bundle", () => runBundleSpecialist(bundleSlice)),
    wrapSpecialist("cache", () => runCacheSpecialist(cacheSlice)),
    wrapSpecialist("cwv", () => runCwvSpecialist(cwvSlice)),
  ]);

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
  const synthController = new AbortController();
  const synthTimer = setTimeout(() => synthController.abort(), SYNTH_TIMEOUT_MS);
  const synthSignal = opts.signal
    ? AbortSignal.any([opts.signal, synthController.signal])
    : synthController.signal;

  let synthOutput;
  try {
    synthOutput = await runSynth(url, outputs, { signal: synthSignal });
  } catch (err) {
    if (synthController.signal.aborted) {
      throw new PipelineError(
        "synth",
        `synthesis timed out after ${SYNTH_TIMEOUT_MS}ms`,
        err,
      );
    }
    if (opts.signal?.aborted) {
      throw new PipelineError("aborted", "analysis aborted by caller", err);
    }
    throw new PipelineError(
      "synth",
      `synthesis failed: ${errorMessage(err)}`,
      err,
    );
  } finally {
    clearTimeout(synthTimer);
  }

  const report: Report = {
    url: psi.finalUrl,
    generatedAt: new Date().toISOString(),
    executiveSummary: synthOutput.executiveSummary,
    topPriority: synthOutput.topPriority,
    findings: synthOutput.findings,
    relatedFindings: synthOutput.relatedFindings,
  };

  return {
    report,
    degradedSpecialists,
    htmlBlocked: htmlResult.blocked,
  };
}

// Wraps a specialist's run function with a per-call timeout. On timeout or
// error, returns a SpecialistOutput whose summary begins with FAILURE_PREFIX
// — the synth prompt knows to skip it. We intentionally DO NOT re-throw:
// keeping the per-lane failure local is what makes "partial failures don't
// fail the whole report" mechanical, not advisory.
async function wrapSpecialist(
  category: FindingCategory,
  run: () => Promise<SpecialistOutput>,
): Promise<SpecialistOutput> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`specialist timeout after ${SPECIALIST_TIMEOUT_MS}ms`));
    }, SPECIALIST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    const reason = errorMessage(err);
    console.error(
      `[pipeline] ${category} specialist failed; degrading lane: ${reason}`,
    );
    return {
      specialist: category,
      findings: [],
      summary: `${FAILURE_PREFIX} ${reason}`,
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
