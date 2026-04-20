"use client";

import type { Finding, FindingCategory } from "@/lib/schemas";
import { SPECIALIST_META, SPECIALIST_ORDER } from "@/lib/ui-meta";
import { cn } from "@/lib/utils";
import { FindingCard } from "./finding-card";

export function FindingsList({
  findings,
  degradedSpecialists,
  // Top priority is rendered emphasized on the synth card; excluding it here
  // prevents the identical finding from appearing twice on the page.
  excludeFindingId,
}: {
  findings: Finding[];
  degradedSpecialists: FindingCategory[];
  excludeFindingId?: string;
}) {
  const visible = excludeFindingId
    ? findings.filter((f) => f.id !== excludeFindingId)
    : findings;
  const byCategory = groupBy(visible, (f) => f.category);
  const degraded = new Set(degradedSpecialists);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          All findings
        </h2>
        <span className="text-xs text-muted-foreground">
          {visible.length} total
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No findings beyond the top priority.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {SPECIALIST_ORDER.map((category) => {
            const items = byCategory.get(category) ?? [];
            const meta = SPECIALIST_META[category];
            const isDegraded = degraded.has(category);

            if (items.length === 0 && !isDegraded) return null;

            return (
              <div
                key={category}
                id={`findings-${category}`}
                className="flex flex-col gap-3 scroll-mt-20"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      meta.accentBg,
                    )}
                    aria-hidden
                  />
                  <h3 className="text-sm font-medium">{meta.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    {items.length} finding{items.length === 1 ? "" : "s"}
                  </span>
                  {isDegraded ? (
                    <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-destructive">
                      degraded
                    </span>
                  ) : null}
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Specialist didn&apos;t return findings in this run.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((f) => (
                      <FindingCard key={f.id} finding={f} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
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
