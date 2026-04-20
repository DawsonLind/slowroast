import Link from "next/link";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cacheTag } from "next/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getVercelFeatureById } from "@/lib/vercel-features";
import type { Finding, FindingCategory } from "@/lib/schemas";
import type { PhaseTimings } from "@/lib/pipeline";
import { BrandMark } from "../_components/brand-mark";
import { KpiTile } from "../_components/kpi-tile";
import {
  SuccessRateChart,
  type SuccessRateRow,
} from "../_components/success-rate-chart";

// ---------------------------------------------------------------------------
// Schema mirrors scripts/eval.ts's ResultsFile. Server-side read only — we
// trust the producer and do not re-validate at runtime; a malformed file is
// a local dev-time bug, not a user-facing surface.
// ---------------------------------------------------------------------------

interface RunError {
  kind: string;
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

interface PhaseStat {
  p50: number;
  max: number;
}

interface UrlAggregates {
  successfulRuns: number;
  failedRuns: number;
  topPriorityConsistency: {
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

const RESULTS_PATH = resolve(process.cwd(), "evals/results.json");

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  image: "Image",
  bundle: "Bundle",
  cache: "Cache",
  cwv: "CWV",
};

const CATEGORIES: readonly FindingCategory[] = [
  "image",
  "bundle",
  "cache",
  "cwv",
];

// Cached at the page level. cacheTag('eval-run') lets a future script
// revalidate via revalidateTag('eval-run', 'max') after writing new results.
async function loadResults(): Promise<ResultsFile | null> {
  "use cache";
  cacheTag("eval-run");
  try {
    const raw = await readFile(RESULTS_PATH, "utf8");
    return JSON.parse(raw) as ResultsFile;
  } catch {
    return null;
  }
}

export default async function EvalsPage() {
  const results = await loadResults();

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark />
            <span className="font-heading text-lg font-semibold tracking-tight">
              Slowroast
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              eval dashboard
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="rounded-sm px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Analyzer
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <section className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Eval results
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Seven hand-picked URLs × three runs each, end-to-end through the
            real pipeline. Each run measures per-phase wall clock, finding
            counts per specialist category, and top-priority stability — three
            runs catch nondeterministic drift the single-run smoke test
            can&apos;t. Sequential URL execution is intentional: the specialist
            fan-out is already p-limit(2), so parallel URLs re-trigger the
            Gateway rate limits we diagnosed on Day 2.
          </p>
        </section>

        {results ? <ResultsContent results={results} /> : <EmptyState />}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Regenerated by <code className="font-mono">npm run eval</code> ·
            evals/results.json
          </span>
          <a
            href="https://github.com/DawsonLind/slowroast"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub ↗
          </a>
        </div>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No eval results yet</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Run <code className="font-mono">npm run eval</code> to populate{" "}
        <code className="font-mono">evals/results.json</code>. The harness takes
        ~26 minutes end-to-end (7 URLs × 3 runs × ~75s).
      </CardContent>
    </Card>
  );
}

function ResultsContent({ results }: { results: ResultsFile }) {
  const { meta, urls } = results;
  const successRate = meta.runsAttempted === 0
    ? 0
    : (meta.runsSucceeded / meta.runsAttempted) * 100;

  const successfulUrls = urls.filter((u) => u.aggregates.successfulRuns > 0);
  const consistentTopPriority = successfulUrls.filter(
    (u) => u.aggregates.topPriorityConsistency.allSameId === true,
  ).length;
  const consistencyRate = successfulUrls.length === 0
    ? 0
    : (consistentTopPriority / successfulUrls.length) * 100;

  const aggregatePhases = aggregatePhaseTimings(urls);
  const uniqueFeaturesHit = countUniqueFeaturesHit(urls);

  const successRows: SuccessRateRow[] = urls.map((u) => ({
    url: u.url,
    host: hostFor(u.url),
    successful: u.aggregates.successfulRuns,
    attempted: u.aggregates.successfulRuns + u.aggregates.failedRuns,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Success rate"
          value={successRate}
          format="percent"
          accent={successRate > 80 ? "positive" : successRate >= 40 ? "primary" : "neutral"}
          sub={`${meta.runsSucceeded} of ${meta.runsAttempted} runs`}
        />
        <KpiTile
          label="URLs analyzed"
          value={urls.length}
          format="int"
          accent="cache"
          sub={`${meta.runsPerUrl} runs each`}
        />
        <KpiTile
          label="Top-priority stable"
          value={consistencyRate}
          format="percent"
          accent={consistencyRate > 80 ? "positive" : "primary"}
          sub={`${consistentTopPriority} of ${successfulUrls.length} URLs agree`}
        />
        <KpiTile
          label="End-to-end p50"
          value={aggregatePhases.total.p50 / 1000}
          format="seconds"
          accent="primary"
          sub={`max ${fmtS(aggregatePhases.total.max)} · ${aggregatePhases.total.count} runs`}
        />
        <KpiTile
          label="Catalog features hit"
          value={uniqueFeaturesHit}
          format="int"
          accent="cwv"
          sub="distinct Vercel recommendations produced"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Success rate per URL</CardTitle>
        </CardHeader>
        <CardContent>
          <SuccessRateChart rows={successRows} />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <LegendSwatch color="var(--color-roast-positive)" label=">80%" />
            <LegendSwatch color="var(--color-sev-medium)" label="40–80%" />
            <LegendSwatch color="var(--color-sev-critical)" label="<40%" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phase timing (across all successful runs)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-medium">Phase</th>
                <th className="pb-2 font-medium text-right">p50</th>
                <th className="pb-2 font-medium text-right">p95</th>
                <th className="pb-2 font-medium text-right">Max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(
                [
                  ["PSI", aggregatePhases.psi],
                  ["Image specialist", aggregatePhases.image],
                  ["Bundle specialist", aggregatePhases.bundle],
                  ["Cache specialist", aggregatePhases.cache],
                  ["CWV specialist", aggregatePhases.cwv],
                  ["Specialist phase (all four)", aggregatePhases.specialistPhase],
                  ["Synth", aggregatePhases.synth],
                  ["Total", aggregatePhases.total],
                ] as const
              ).map(([label, stat]) => (
                <tr key={label}>
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtS(stat.p50)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtS(stat.p95)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtS(stat.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-3 text-xs text-muted-foreground">
            Harness timeouts: PSI {fmtS(meta.psiTimeoutMs)} · synth{" "}
            {fmtS(meta.synthTimeoutMs)} (eval-tier; the API route uses a
            tighter 30s synth cap — see decisions log).
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Per-URL results
        </h2>
        <div className="flex flex-col gap-3">
          {urls.map((u) => (
            <UrlRow key={u.url} record={u} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-4 rounded-sm"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}

function countUniqueFeaturesHit(urls: UrlRecord[]): number {
  const set = new Set<string>();
  for (const u of urls) {
    for (const id of u.aggregates.uniqueCatalogFeatures) set.add(id);
  }
  return set.size;
}

function UrlRow({ record }: { record: UrlRecord }) {
  const { url, runs, aggregates } = record;
  const consistency = aggregates.topPriorityConsistency;
  const stability = describeTopPriorityStability(consistency);
  const allIds = consistency.ids;
  const totalRuns = aggregates.successfulRuns + aggregates.failedRuns;
  const allSuccessful = aggregates.failedRuns === 0 && aggregates.successfulRuns > 0;
  const allFailed = aggregates.successfulRuns === 0 && aggregates.failedRuns > 0;

  return (
    <details className="group rounded-xl bg-card ring-1 ring-foreground/10 open:ring-foreground/20">
      <summary className="flex cursor-pointer list-none flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] tabular-nums font-medium",
              allSuccessful
                ? "bg-[color:var(--color-roast-positive)]/15 text-[color:var(--color-roast-positive)]"
                : allFailed
                  ? "bg-destructive/10 text-destructive"
                  : "bg-sev-medium/15 text-sev-medium",
            )}
            title="Successful runs / total runs"
          >
            {aggregates.successfulRuns}/{totalRuns} runs
          </span>
          <span className="font-mono text-sm font-medium truncate">{hostFor(url)}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">{url}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn("rounded-full px-2 py-0.5", stability.cls)}
            title="Top-priority stability across runs — whether the synth flagged the same top issue each time"
          >
            {stability.label}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground tabular-nums">
            {fmtS(aggregates.phaseTimings.total.p50)} p50
          </span>
          {aggregates.htmlBlockedAnyRun ? (
            <span className="rounded-full bg-sev-medium/15 px-2 py-0.5 text-sev-medium">
              html-blocked
            </span>
          ) : null}
          {aggregates.degradedSpecialistsUnion.length > 0 ? (
            <span className="rounded-full bg-sev-medium/15 px-2 py-0.5 text-sev-medium">
              degraded: {aggregates.degradedSpecialistsUnion.join(", ")}
            </span>
          ) : null}
        </div>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <RunTopPriorityTable
            ids={allIds}
            featureIds={consistency.featureIds}
            uniqueIdCount={consistency.uniqueIdCount}
          />
          <FindingsCountTable aggregates={aggregates} />
        </div>

        <RunDetails runs={runs} />

        {aggregates.uniqueCatalogFeatures.length > 0 ? (
          <CatalogFeatureList features={aggregates.uniqueCatalogFeatures} />
        ) : null}
      </div>
    </details>
  );
}

function RunTopPriorityTable({
  ids,
  featureIds,
  uniqueIdCount,
}: {
  ids: (string | null)[];
  featureIds: (string | null)[];
  uniqueIdCount: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Top priority per run ({uniqueIdCount} unique id{uniqueIdCount === 1 ? "" : "s"})
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-medium">Run</th>
            <th className="pb-1 font-medium">Finding id</th>
            <th className="pb-1 font-medium">Vercel feature</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ids.map((id, i) => (
            <tr key={i}>
              <td className="py-1 tabular-nums">{i + 1}</td>
              <td className="py-1 font-mono truncate max-w-[200px]" title={id ?? ""}>
                {id ?? "(none)"}
              </td>
              <td className="py-1 font-mono truncate max-w-[200px]" title={featureIds[i] ?? ""}>
                {featureIds[i] ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsCountTable({ aggregates }: { aggregates: UrlAggregates }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Findings count by category (min–max)
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-medium">Category</th>
            <th className="pb-1 font-medium text-right">Min</th>
            <th className="pb-1 font-medium text-right">p50</th>
            <th className="pb-1 font-medium text-right">Max</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {CATEGORIES.map((cat) => {
            const s = aggregates.findingsCountByCategory[cat];
            return (
              <tr key={cat}>
                <td className="py-1">{CATEGORY_LABEL[cat]}</td>
                <td className="py-1 text-right tabular-nums">{s.min}</td>
                <td className="py-1 text-right tabular-nums">{s.p50}</td>
                <td className="py-1 text-right tabular-nums">{s.max}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunDetails({ runs }: { runs: RunRecord[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Run details
      </div>
      <div className="flex flex-col gap-2">
        {runs.map((r) => (
          <div
            key={r.index}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs"
          >
            <span className="tabular-nums">#{r.index + 1}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                r.status === "success"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {r.status}
            </span>
            <span className="tabular-nums text-muted-foreground">
              total {fmtS(r.totalWallClockMs)}
            </span>
            {r.status === "success" ? (
              <>
                <span className="tabular-nums text-muted-foreground">
                  psi {fmtS(r.phaseTimings.psiMs)} · spec {fmtS(r.phaseTimings.specialistPhaseMs)} · synth {fmtS(r.phaseTimings.synthMs)}
                </span>
                <span className="text-muted-foreground">
                  {r.findings.length} finding{r.findings.length === 1 ? "" : "s"}
                </span>
                {r.topPriority ? (
                  <span className="font-mono">
                    top: {r.topPriority.id} → {r.topPriority.vercelFeatureId}
                  </span>
                ) : (
                  <span className="text-muted-foreground">no top priority</span>
                )}
              </>
            ) : (
              <span className="font-mono text-destructive">
                {r.error.kind}: {r.error.message}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogFeatureList({ features }: { features: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Catalog features referenced ({features.length})
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {features.map((id) => {
          const feature = getVercelFeatureById(id);
          if (!feature) {
            return (
              <span
                key={id}
                className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-destructive"
              >
                {id} (unknown)
              </span>
            );
          }
          return (
            <a
              key={id}
              href={feature.vercelDocs}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-muted px-2 py-0.5 font-mono hover:bg-muted/60"
              title={feature.title}
            >
              {id}
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

interface CrossRunPhaseStat {
  p50: number;
  p95: number;
  max: number;
  count: number;
}

interface CrossRunPhases {
  psi: CrossRunPhaseStat;
  image: CrossRunPhaseStat;
  bundle: CrossRunPhaseStat;
  cache: CrossRunPhaseStat;
  cwv: CrossRunPhaseStat;
  specialistPhase: CrossRunPhaseStat;
  synth: CrossRunPhaseStat;
  total: CrossRunPhaseStat;
}

function aggregatePhaseTimings(urls: UrlRecord[]): CrossRunPhases {
  const collect = (pick: (p: PhaseTimings) => number): number[] => {
    const values: number[] = [];
    for (const u of urls) {
      for (const run of u.runs) {
        if (run.status === "success") values.push(pick(run.phaseTimings));
      }
    }
    return values;
  };

  const stat = (values: number[]): CrossRunPhaseStat => {
    if (values.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (p: number): number => {
      const rank = Math.ceil((p / 100) * sorted.length);
      const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
      return sorted[idx];
    };
    return {
      p50: pick(50),
      p95: pick(95),
      max: sorted[sorted.length - 1],
      count: sorted.length,
    };
  };

  return {
    psi: stat(collect((p) => p.psiMs)),
    image: stat(collect((p) => p.imageMs)),
    bundle: stat(collect((p) => p.bundleMs)),
    cache: stat(collect((p) => p.cacheMs)),
    cwv: stat(collect((p) => p.cwvMs)),
    specialistPhase: stat(collect((p) => p.specialistPhaseMs)),
    synth: stat(collect((p) => p.synthMs)),
    total: stat(collect((p) => p.totalMs)),
  };
}

interface StabilityLabel {
  label: string;
  cls: string;
}

// Describes the stability of top-priority across runs. This is *not* a
// pass/fail signal — an unstable top priority on three successful runs still
// means the pipeline worked; it just means the synth's ranking is sensitive
// to variance. Keep these colors amber/muted, not destructive, so the row
// doesn't read as "failed" when the underlying runs are green.
function describeTopPriorityStability(
  consistency: UrlAggregates["topPriorityConsistency"],
): StabilityLabel {
  if (consistency.ids.length === 0) {
    return {
      label: "top-priority n/a",
      cls: "bg-muted text-muted-foreground",
    };
  }
  if (consistency.allSameId === true) {
    return {
      label: `top-priority ✓ stable (${consistency.ids.length}/${consistency.ids.length})`,
      cls: "bg-[color:var(--color-roast-positive)]/15 text-[color:var(--color-roast-positive)]",
    };
  }
  if (consistency.uniqueIdCount === 2) {
    return {
      label: `top-priority ⚠ drift (${consistency.ids.length - 1}/${consistency.ids.length} majority)`,
      cls: "bg-sev-medium/15 text-sev-medium",
    };
  }
  return {
    label: `top-priority ⚠ unstable (${consistency.uniqueIdCount} distinct)`,
    cls: "bg-sev-medium/15 text-sev-medium",
  };
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fmtS(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
