// Slowroast score: a gentler headline number derived from the raw PageSpeed
// Insights Lighthouse performance score.
//
// Why: PSI Lighthouse is strict by design (and rightly so for engineering
// ground truth), but most competently-built real-world sites cluster in the
// 40–75 band — which reads as "failing" to anyone who saw 70/100 on a
// homework assignment. The user-facing headline should encourage rather than
// scold, while the raw PSI number remains visible for anyone who wants the
// unvarnished Lighthouse signal.
//
// Curve: `displayed = round(100 * sqrt(psi/100))`. Sqrt stretches the middle
// band where well-built sites live without inflating the top or letting a
// truly broken site pass. Sample mapping:
//   PSI  28 → 53  (D, "Needs work")
//   PSI  50 → 71  (C, "Room to grow")
//   PSI  71 → 84  (B, "Solid")
//   PSI  85 → 92  (A, "Great")
//   PSI 100 → 100 (A+, "Excellent")
//
// Specialists still reason on raw PSI in their analysis — the curve only
// applies to the report-level headline. Keeps facts and framing separate.

export interface SlowroastScore {
  // Curved score on the 0–100 range.
  score: number;
  // Letter grade derived from the curved score. A+ / A / B / C / D / F.
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  // Short human label aligned with the grade.
  band: string;
  // The raw PSI Lighthouse performance score expressed 0–100 (null when PSI
  // returned a null performance score, which happens for extreme failures).
  // Surfaced verbatim so the UI can render a "PSI raw: X/100" transparency
  // footnote without re-deriving from the report-level PSI field.
  psiRaw: number | null;
}

export function computeSlowroastScore(
  psiPerformance: number | null,
): SlowroastScore | null {
  if (psiPerformance == null) return null;

  // PSI categories[*].score is a 0–1 decimal per the Lighthouse API contract;
  // we defensively clamp in case a future change ever hands us a pre-scaled
  // value or a NaN.
  const psi01 = clamp(psiPerformance, 0, 1);
  const psiRaw = Math.round(psi01 * 100);
  const curved = Math.round(100 * Math.sqrt(psi01));
  const score = clamp(curved, 0, 100);

  const { grade, band } = gradeFor(score);
  return { score, grade, band, psiRaw };
}

function gradeFor(score: number): { grade: SlowroastScore["grade"]; band: string } {
  if (score >= 95) return { grade: "A+", band: "Excellent" };
  if (score >= 85) return { grade: "A", band: "Great" };
  if (score >= 75) return { grade: "B", band: "Solid" };
  if (score >= 65) return { grade: "C", band: "Room to grow" };
  if (score >= 55) return { grade: "D", band: "Needs work" };
  return { grade: "F", band: "Serious work ahead" };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
