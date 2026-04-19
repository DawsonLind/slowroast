// Eval harness — runs runAnalysis across the golden URL set, 3 runs per URL,
// strictly sequentially. Writes a single structured results file that the
// /evals dashboard consumes.
//
// Usage:
//   npm run eval                      # full 7-URL run against the golden set
//   npm run eval -- --url=vercel.com  # single-URL smoke test (3 runs)
//   npm run eval -- --runs=1          # override runs per URL (default 3)
//
// URL-level sequentiality is intentional: the Gateway is already at p-limit(2)
// within each run (see lib/pipeline.ts). Running URLs in parallel stacks
// concurrent specialist calls and re-triggers the 429s we diagnosed on Day 2.
//
// Retry policy: a single failed run is logged and we advance to the next run
// of the same URL. Never retry a single run. Never re-run a URL's 3-run set.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAnalysis, PipelineError } from "@/lib/pipeline";
import type { PhaseTimings } from "@/lib/pipeline";
import type { Finding, FindingCategory, Report } from "@/lib/schemas";

const GOLDEN_URLS: readonly string[] = [
  "https://hulu.com",
  "https://reddit.com",
  "https://developer.mozilla.org",
  "https://github.com",
  "https://ticketmaster.com",
  "https://gov.uk",
  "https://vercel.com",
];

// Eval-tier timeouts. PSI bumps to 60s (vs the route's 30s default) because
// real-world golden URLs vary; same logic applies to synth. Day 3 verification
// against the golden set showed the 30s synth default timing out consistently
// on large sites (hulu.com: 3/3 timeouts; reddit.com: timeout + schema fail).
// Sonnet 4.6 p50 on vercel.com was ~26s — fine — but findings-rich sites push
// the structured-output call past 30s every time. 60s here is the eval-tier
// carve-out so the dashboard can show real numbers rather than all failures.
// The API route keeps 30s so the user-facing UX still fails fast.
const PSI_TIMEOUT_MS = 60_000;
const SYNTH_TIMEOUT_MS = 60_000;
const DEFAULT_RUNS_PER_URL = 3;
const OUTPUT_PATH = resolve(process.cwd(), "evals/results.json");

const FINDING_CATEGORIES: readonly FindingCategory[] = [
  "image",
  "bundle",
  "cache",
  "cwv",
];

// ---------------------------------------------------------------------------
// Result shape — the /evals dashboard reads this file. Keep ordering stable
// so diffs between eval runs stay readable.
// ---------------------------------------------------------------------------

interface RunError {
  kind: string; // PipelineErrorKind | "unknown"
  message: string;
}

interface SuccessfulRun {
  index: number;
  status: "success";
  startedAt: string;
  finishedAt: string;
  totalWallClockMs: number;
  error: null;
  htmlBlocked: boolean;
  degradedSpecialists: FindingCategory[];
  phaseTimings: PhaseTimings;
  findingsByCategory: Record<FindingCategory, number>;
  topPriority: {
    id: string;
    vercelFeatureId: string;
    category: FindingCategory;
    severity: string;
  } | null;
  executiveSummary: string;
  findings: Finding[];
}

interface FailedRun {
  index: number;
  status: "failed";
  startedAt: string;
  finishedAt: string;
  totalWallClockMs: number;
  error: RunError;
}

type RunRecord = SuccessfulRun | FailedRun;

interface UrlAggregates {
  successfulRuns: number;
  failedRuns: number;
  topPriorityConsistency: {
    // null when no successful run produced a topPriority.
    allSameId: boolean | null;
    allSameFeatureId: boolean | null;
    ids: (string | null)[];
    featureIds: (string | null)[];
    uniqueIdCount: number;
    uniqueFeatureIdCount: number;
  };
  findingsCountByCategory: Record<
    FindingCategory,
    { min: number; max: number; p50: number }
  >;
  uniqueCatalogFeatures: string[];
  phaseTimings: {
    psi: PhaseStat;
    image: PhaseStat;
    bundle: PhaseStat;
    cache: PhaseStat;
    cwv: PhaseStat;
    specialistPhase: PhaseStat;
    synth: PhaseStat;
    total: PhaseStat;
  };
  htmlBlockedAnyRun: boolean;
  degradedSpecialistsUnion: FindingCategory[];
}

interface PhaseStat {
  p50: number;
  max: number;
}

interface UrlRecord {
  url: string;
  runs: RunRecord[];
  aggregates: UrlAggregates;
}

interface ResultsFile {
  meta: {
    startedAt: string;
    finishedAt: string;
    totalWallClockMs: number;
    runsAttempted: number;
    runsSucceeded: number;
    runsFailed: number;
    urlsWithInconsistentTopPriority: string[];
    runsPerUrl: number;
    psiTimeoutMs: number;
    synthTimeoutMs: number;
  };
  urls: UrlRecord[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(): { urls: readonly string[]; runsPerUrl: number } {
  let runsPerUrl = DEFAULT_RUNS_PER_URL;
  let urlOverride: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--runs=")) {
      const n = Number(arg.slice("--runs=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --runs value: ${arg}`);
      }
      runsPerUrl = Math.floor(n);
    } else if (arg.startsWith("--url=")) {
      const raw = arg.slice("--url=".length);
      urlOverride = raw.startsWith("http") ? raw : `https://${raw}`;
    }
  }

  if (urlOverride !== null) {
    return { urls: [urlOverride], runsPerUrl };
  }
  return { urls: GOLDEN_URLS, runsPerUrl };
}

async function main(): Promise<void> {
  const { urls, runsPerUrl } = parseArgs();
  const evalStartedAt = Date.now();
  const startedAtIso = new Date().toISOString();

  console.error(
    `[eval] starting — ${urls.length} URL(s), ${runsPerUrl} run(s) each, sequential`,
  );

  const urlRecords: UrlRecord[] = [];
  let runsAttempted = 0;
  let runsSucceeded = 0;
  let runsFailed = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const runs: RunRecord[] = [];
    for (let r = 0; r < runsPerUrl; r++) {
      runsAttempted += 1;
      const runStartMs = Date.now();
      const runStartedAt = new Date().toISOString();
      const elapsedS = ((Date.now() - evalStartedAt) / 1000).toFixed(0);
      console.error(
        `[eval] URL ${i + 1}/${urls.length} ${url} | run ${r + 1}/${runsPerUrl} | phase: start | elapsed: ${elapsedS}s`,
      );
      try {
        const result = await runAnalysis(url, {
          psiTimeoutMs: PSI_TIMEOUT_MS,
          synthTimeoutMs: SYNTH_TIMEOUT_MS,
        });
        const finishedAt = new Date().toISOString();
        const totalWallClockMs = Date.now() - runStartMs;
        const record = toSuccessfulRun(r, runStartedAt, finishedAt, totalWallClockMs, result.report, result);
        runs.push(record);
        runsSucceeded += 1;
        console.error(
          `[eval]   ✓ run ${r + 1} ok in ${totalWallClockMs}ms | findings=${record.findings.length} | top=${record.topPriority?.id ?? "(none)"} | htmlBlocked=${record.htmlBlocked} | degraded=[${record.degradedSpecialists.join(",")}]`,
        );
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const totalWallClockMs = Date.now() - runStartMs;
        const errorRecord = toRunError(err);
        runs.push({
          index: r,
          status: "failed",
          startedAt: runStartedAt,
          finishedAt,
          totalWallClockMs,
          error: errorRecord,
        });
        runsFailed += 1;
        console.error(
          `[eval]   ✗ run ${r + 1} failed in ${totalWallClockMs}ms: ${errorRecord.kind}: ${errorRecord.message}`,
        );
      }

      // Persist after every run so a long eval doesn't lose data if it crashes.
      // The file is overwritten each eval run — evals are expensive, we want
      // the latest, and intermediate state is useful if we kill the process.
      writeResultsSoFar({
        startedAtIso,
        evalStartedAt,
        urlRecords,
        currentUrl: url,
        currentRuns: runs,
        runsAttempted,
        runsSucceeded,
        runsFailed,
        urls,
        runsPerUrl,
      });
    }

    const aggregates = computeAggregates(runs);
    urlRecords.push({ url, runs, aggregates });
  }

  const finishedAtIso = new Date().toISOString();
  const totalWallClockMs = Date.now() - evalStartedAt;
  const urlsWithInconsistentTopPriority = urlRecords
    .filter(
      (r) =>
        r.aggregates.topPriorityConsistency.allSameId === false ||
        r.aggregates.topPriorityConsistency.allSameFeatureId === false,
    )
    .map((r) => r.url);

  const results: ResultsFile = {
    meta: {
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      totalWallClockMs,
      runsAttempted,
      runsSucceeded,
      runsFailed,
      urlsWithInconsistentTopPriority,
      runsPerUrl,
      psiTimeoutMs: PSI_TIMEOUT_MS,
      synthTimeoutMs: SYNTH_TIMEOUT_MS,
    },
    urls: urlRecords,
  };

  writeResultsFile(results);

  const totalS = (totalWallClockMs / 1000).toFixed(0);
  console.error(
    `[eval] done in ${totalS}s | ${runsSucceeded}/${runsAttempted} runs succeeded (${runsFailed} failed) | ${urlsWithInconsistentTopPriority.length} URL(s) with inconsistent topPriority`,
  );
  if (urlsWithInconsistentTopPriority.length > 0) {
    console.error(`[eval]   inconsistent: ${urlsWithInconsistentTopPriority.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Per-run transformation
// ---------------------------------------------------------------------------

interface AnalysisResultLike {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
  phaseTimings: PhaseTimings;
}

function toSuccessfulRun(
  index: number,
  startedAt: string,
  finishedAt: string,
  totalWallClockMs: number,
  report: Report,
  result: AnalysisResultLike,
): SuccessfulRun {
  const findingsByCategory = countFindingsByCategory(report.findings);
  return {
    index,
    status: "success",
    startedAt,
    finishedAt,
    totalWallClockMs,
    error: null,
    htmlBlocked: result.htmlBlocked,
    degradedSpecialists: result.degradedSpecialists,
    phaseTimings: result.phaseTimings,
    findingsByCategory,
    topPriority: report.topPriority
      ? {
          id: report.topPriority.id,
          vercelFeatureId: report.topPriority.vercelFeatureId,
          category: report.topPriority.category,
          severity: report.topPriority.severity,
        }
      : null,
    executiveSummary: report.executiveSummary,
    findings: report.findings,
  };
}

function countFindingsByCategory(
  findings: Finding[],
): Record<FindingCategory, number> {
  const counts: Record<FindingCategory, number> = {
    image: 0,
    bundle: 0,
    cache: 0,
    cwv: 0,
  };
  for (const f of findings) counts[f.category] += 1;
  return counts;
}

function toRunError(err: unknown): RunError {
  if (err instanceof PipelineError) {
    return { kind: err.kind, message: err.message };
  }
  if (err instanceof Error) {
    return { kind: "unknown", message: err.message };
  }
  return { kind: "unknown", message: String(err) };
}

// ---------------------------------------------------------------------------
// Per-URL aggregation
// ---------------------------------------------------------------------------

function computeAggregates(runs: RunRecord[]): UrlAggregates {
  const successful = runs.filter(
    (r): r is SuccessfulRun => r.status === "success",
  );

  const ids = successful.map((r) => r.topPriority?.id ?? null);
  const featureIds = successful.map((r) => r.topPriority?.vercelFeatureId ?? null);
  const uniqueIds = new Set(ids.filter((x): x is string => x !== null));
  const uniqueFeatureIds = new Set(
    featureIds.filter((x): x is string => x !== null),
  );
  const topPriorityConsistency: UrlAggregates["topPriorityConsistency"] = {
    allSameId: ids.length === 0 ? null : uniqueIds.size === 1 && !ids.includes(null),
    allSameFeatureId:
      featureIds.length === 0
        ? null
        : uniqueFeatureIds.size === 1 && !featureIds.includes(null),
    ids,
    featureIds,
    uniqueIdCount: uniqueIds.size,
    uniqueFeatureIdCount: uniqueFeatureIds.size,
  };

  const findingsCountByCategory = {} as Record<
    FindingCategory,
    { min: number; max: number; p50: number }
  >;
  for (const cat of FINDING_CATEGORIES) {
    const counts = successful.map((r) => r.findingsByCategory[cat]);
    findingsCountByCategory[cat] = {
      min: counts.length ? Math.min(...counts) : 0,
      max: counts.length ? Math.max(...counts) : 0,
      p50: percentile(counts, 50),
    };
  }

  const allFindingFeatureIds = new Set<string>();
  for (const r of successful) {
    if (r.topPriority) allFindingFeatureIds.add(r.topPriority.vercelFeatureId);
    for (const f of r.findings) allFindingFeatureIds.add(f.vercelFeatureId);
  }

  const phaseTimings: UrlAggregates["phaseTimings"] = {
    psi: statFrom(successful.map((r) => r.phaseTimings.psiMs)),
    image: statFrom(successful.map((r) => r.phaseTimings.imageMs)),
    bundle: statFrom(successful.map((r) => r.phaseTimings.bundleMs)),
    cache: statFrom(successful.map((r) => r.phaseTimings.cacheMs)),
    cwv: statFrom(successful.map((r) => r.phaseTimings.cwvMs)),
    specialistPhase: statFrom(
      successful.map((r) => r.phaseTimings.specialistPhaseMs),
    ),
    synth: statFrom(successful.map((r) => r.phaseTimings.synthMs)),
    total: statFrom(successful.map((r) => r.phaseTimings.totalMs)),
  };

  const degradedSet = new Set<FindingCategory>();
  for (const r of successful) for (const c of r.degradedSpecialists) degradedSet.add(c);

  return {
    successfulRuns: successful.length,
    failedRuns: runs.length - successful.length,
    topPriorityConsistency,
    findingsCountByCategory,
    uniqueCatalogFeatures: [...allFindingFeatureIds].sort(),
    phaseTimings,
    htmlBlockedAnyRun: successful.some((r) => r.htmlBlocked),
    degradedSpecialistsUnion: [...degradedSet].sort(),
  };
}

function statFrom(values: number[]): PhaseStat {
  if (values.length === 0) return { p50: 0, max: 0 };
  return { p50: percentile(values, 50), max: Math.max(...values) };
}

// Nearest-rank percentile on a small sample. Matches the intuitive shape for
// n=3 runs: p50 on [a,b,c] returns b.
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Persistence — atomic-ish overwrite of evals/results.json
// ---------------------------------------------------------------------------

interface IncrementalState {
  startedAtIso: string;
  evalStartedAt: number;
  urlRecords: UrlRecord[];
  currentUrl: string;
  currentRuns: RunRecord[];
  runsAttempted: number;
  runsSucceeded: number;
  runsFailed: number;
  urls: readonly string[];
  runsPerUrl: number;
}

function writeResultsSoFar(state: IncrementalState): void {
  const inProgress: UrlRecord = {
    url: state.currentUrl,
    runs: state.currentRuns,
    aggregates: computeAggregates(state.currentRuns),
  };
  const partial: ResultsFile = {
    meta: {
      startedAt: state.startedAtIso,
      finishedAt: new Date().toISOString(),
      totalWallClockMs: Date.now() - state.evalStartedAt,
      runsAttempted: state.runsAttempted,
      runsSucceeded: state.runsSucceeded,
      runsFailed: state.runsFailed,
      urlsWithInconsistentTopPriority: [],
      runsPerUrl: state.runsPerUrl,
      psiTimeoutMs: PSI_TIMEOUT_MS,
      synthTimeoutMs: SYNTH_TIMEOUT_MS,
    },
    urls: [...state.urlRecords, inProgress],
  };
  writeResultsFile(partial);
}

function writeResultsFile(results: ResultsFile): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2) + "\n", "utf8");
}

main().catch((err) => {
  console.error("[eval] fatal error:", err);
  process.exit(1);
});
