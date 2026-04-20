import { z } from "zod";
import {
  FindingCategorySchema,
  SeveritySchema,
  type FindingCategory,
  type Severity,
} from "@/lib/schemas";
import type { PhaseTimings } from "@/lib/pipeline";
import type { Report } from "@/lib/schemas";

// Wire format between the /api/analyze route and the analyzer client. Each
// event is serialized as one NDJSON line. We keep the schema strict at the
// client boundary so a malformed line fails fast rather than silently drifting
// the UI. The "result" event carries the final payload — same shape as the
// pre-streaming JSON response, so downstream consumers didn't have to change.

export const ProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("phase"),
    phase: z.enum(["psi", "html"]),
    status: z.enum(["start", "done"]),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("specialist"),
    category: FindingCategorySchema,
    status: z.enum(["queued", "running", "done", "failed"]),
    durationMs: z.number().optional(),
    findingsCount: z.number().optional(),
    topSeverity: SeveritySchema.optional(),
  }),
  z.object({
    type: z.literal("synth"),
    status: z.enum(["start", "done"]),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("result"),
    // Validated by ReportSchema on the caller side — keeping it unknown here
    // avoids pulling the full Report schema into the event union.
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("error"),
    kind: z.string(),
    message: z.string(),
  }),
]);

export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

// Shape of the "result" event's payload. Matches the pre-streaming response
// body of /api/analyze so downstream code (analyzer.tsx) can reuse the same
// type narrowing it already did.
export interface AnalyzeResultPayload {
  report: Report;
  degradedSpecialists: FindingCategory[];
  htmlBlocked: boolean;
  phaseTimings: PhaseTimings;
}

// Convenience re-exports so callers don't also import from schemas just to
// type an event's fields.
export type { FindingCategory, Severity };
