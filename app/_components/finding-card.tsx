import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getVercelFeatureById,
  type VercelFeatureId,
} from "@/lib/vercel-features";
import type { Finding } from "@/lib/schemas";
import { SPECIALIST_META } from "@/lib/ui-meta";
import { SeverityBadge } from "./severity-badge";

export function FindingCard({
  finding,
  emphasis = false,
  id,
}: {
  finding: Finding;
  emphasis?: boolean;
  id?: string;
}) {
  const meta = SPECIALIST_META[finding.category];
  return (
    <Card
      id={id}
      size={emphasis ? undefined : "sm"}
      className={cn(
        emphasis &&
          "ring-2 ring-primary/60 shadow-[0_0_0_1px_var(--color-primary)]",
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                meta.accentBg,
              )}
              aria-hidden
            />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {emphasis ? `Top priority · ${meta.shortLabel}` : meta.shortLabel}
            </span>
          </div>
          <SeverityBadge severity={finding.severity} />
        </div>
        <CardTitle className={cn(emphasis ? "text-xl leading-snug" : undefined)}>
          {finding.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FindingBody finding={finding} />
      </CardContent>
    </Card>
  );
}

function FindingBody({ finding }: { finding: Finding }) {
  const feature = getVercelFeatureById(
    finding.vercelFeatureId as VercelFeatureId,
  );
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
          className="absolute inset-y-0 left-0 bg-primary/80"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}
