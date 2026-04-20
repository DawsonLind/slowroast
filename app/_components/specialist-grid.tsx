"use client";

import type { FindingCategory, Severity } from "@/lib/schemas";
import { SPECIALIST_ORDER } from "@/lib/ui-meta";
import { SpecialistCard, type SpecialistStatus } from "./specialist-card";

export interface SpecialistViewState {
  status: SpecialistStatus;
  findingsCount?: number;
  topSeverity?: Severity;
}

export function SpecialistGrid({
  states,
  elapsedMs,
  onCardClick,
}: {
  states: Record<FindingCategory, SpecialistViewState>;
  elapsedMs: number;
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
            elapsedMs={elapsedMs}
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
