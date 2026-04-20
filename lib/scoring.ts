// Gentler headline score derived from the raw PSI Lighthouse performance
// score. PSI is strict by design which is fine for engineering ground truth,
// but real well-built sites cluster in the 40-75 band and a bare 70/100
// reads as "failing" to most people. The UI shows the curved number as the
// headline and keeps the raw PSI number visible as a footnote.
//
// Curve is round(100 * sqrt(psi/100)). Stretches the middle where good sites
// live without inflating the top. Rough mapping:
//   psi 28  -> 53  (D)
//   psi 50  -> 71  (C)
//   psi 71  -> 84  (B)
//   psi 85  -> 92  (A)
//   psi 100 -> 100 (A+)
//
// Specialists still see the raw psi number - the curve is presentation only.

export interface SlowroastScore {
  // curved 0-100 score
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  // short label to pair with the grade
  band: string;
  // raw PSI perf score on 0-100 (null when PSI returned null, rare)
  // surfaced so the UI can show "PSI raw: X/100" without recomputing
  psiRaw: number | null;
}

export function computeSlowroastScore(
  psiPerformance: number | null,
): SlowroastScore | null {
  if (psiPerformance == null) return null;

  // PSI categories[*].score is a 0-1 decimal per the lighthouse contract.
  // clamp defensively in case something ever hands us a pre-scaled value or NaN
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
