"use client";

import type { FindingCategory, Severity } from "@/lib/schemas";
import { SPECIALIST_ORDER } from "@/lib/ui-meta";
import { SpecialistCard, type SpecialistStatus } from "./specialist-card";

export interface SpecialistViewState {
  status: SpecialistStatus;
  findingsCount?: number;
  topSeverity?: Severity;
  // Wall-clock timestamps driven by real server-side events. The card uses
  // these to render elapsed time without relying on a client-wide ticker.
  startedAt?: number;
  completedAt?: number;
}

export function SpecialistGrid({
  states,
  onCardClick,
}: {
  states: Record<FindingCategory, SpecialistViewState>;
  onCardClick?: (category: FindingCategory) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {SPECIALIST_ORDER.map((category) => {
        const s = states[category];
        return (
          <SpecialistCard
            key={category}
            category={category}
            status={s.status}
            startedAt={s.startedAt}
            completedAt={s.completedAt}
            findingsCount={s.findingsCount}
            topSeverity={s.topSeverity}
            onClick={
              onCardClick && s.status === "done"
                ? () => onCardClick(category)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
