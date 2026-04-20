import { z } from "zod";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "opportunity",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
  "image",
  "bundle",
  "cache",
  "cwv",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const EffortSchema = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof EffortSchema>;

// Plain-string vercelFeatureId here — strict validation against the catalog
// happens in lib/vercel-features.ts via FindingWithValidatedFeatureSchema.
// Keeps schemas.ts catalog-free to avoid a circular import.
export const FindingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  category: FindingCategorySchema,
  affectedResources: z.array(z.string()),
  estimatedImpact: z.string(),
  vercelFeatureId: z.string(),
  evidence: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SpecialistOutputSchema = z.object({
  specialist: FindingCategorySchema,
  findings: z.array(FindingSchema),
  summary: z.string(),
});
export type SpecialistOutput = z.infer<typeof SpecialistOutputSchema>;

// Report-level Slowroast score. Derived deterministically from the raw PSI
// performance score by lib/scoring.ts — stamped in code, not emitted by the
// synthesizer. Optional because null PSI scores (rare, happens on extreme
// failures) produce no score at all rather than a misleading zero.
export const SlowroastScoreSchema = z.object({
  score: z.number().min(0).max(100),
  grade: z.enum(["A+", "A", "B", "C", "D", "F"]),
  band: z.string().min(1),
  psiRaw: z.number().min(0).max(100).nullable(),
});
export type SlowroastScoreReport = z.infer<typeof SlowroastScoreSchema>;

export const ReportSchema = z.object({
  url: z.string().url(),
  generatedAt: z.string().datetime(),
  executiveSummary: z.string(),
  // Gentler headline score + letter grade. See lib/scoring.ts for the curve.
  // Optional so a null PSI performance score doesn't break the report shape.
  slowroastScore: SlowroastScoreSchema.optional(),
  // Optional: a well-cached well-built site can legitimately produce zero
  // findings. The synthesizer emits topPriority only when `findings` is
  // non-empty; downstream UI renders a "no issues found" branch otherwise.
  topPriority: FindingSchema.optional(),
  findings: z.array(FindingSchema),
  // Map from a finding id to the ids of other findings that share its root
  // cause — used when the synthesizer sees two specialists describe the same
  // issue and wants to link them without duplicating payload. IDs, not full
  // Finding objects: that matches the model's natural output shape (see
  // lib/synth.ts ModelSynthOutputSchema), avoids duplication, and keeps the
  // UI free to resolve the link itself.
  relatedFindings: z.record(z.string(), z.array(z.string())).optional(),
});
export type Report = z.infer<typeof ReportSchema>;

export const VercelFeatureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  feature: z.string().min(1),
  vercelDocs: z.string().url(),
  nextDocs: z.string().url(),
  category: FindingCategorySchema,
  when: z.string().min(1),
  impact: z.string().min(1),
  effort: EffortSchema,
});
export type VercelFeature = z.infer<typeof VercelFeatureSchema>;

// ---------------------------------------------------------------------------
// PSI (PageSpeed Insights v5) — narrow schemas. We pin only the fields we read.
// Google's full response is large and evolves; validating what we consume
// enforces the contract without making us own Google's entire schema.
// ---------------------------------------------------------------------------

export const PsiAuditSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().nullable(),
  numericValue: z.number().optional(),
  displayValue: z.string().optional(),
  details: z.unknown().optional(),
});
export type PsiAudit = z.infer<typeof PsiAuditSchema>;

export const PsiLighthouseResultSchema = z.object({
  finalUrl: z.string(),
  lighthouseVersion: z.string(),
  categories: z.object({
    performance: z.object({
      score: z.number().nullable(),
    }),
  }),
  audits: z.record(z.string(), PsiAuditSchema),
});
export type PsiLighthouseResult = z.infer<typeof PsiLighthouseResultSchema>;

export const PsiResponseSchema = z.object({
  lighthouseResult: PsiLighthouseResultSchema,
});
export type PsiResponse = z.infer<typeof PsiResponseSchema>;

// ---------------------------------------------------------------------------
// HTML fetch — always resolves, carries `blocked: true` when a WAF/timeout
// denies us. Downstream specialists reduce confidence rather than erroring.
// ---------------------------------------------------------------------------

export const HtmlFetchResultSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  html: z.string().nullable(),
  blocked: z.boolean(),
  reason: z.string().optional(),
});
export type HtmlFetchResult = z.infer<typeof HtmlFetchResultSchema>;
