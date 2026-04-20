import { generateObject, NoObjectGeneratedError } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import type { Finding, SpecialistOutput } from "@/lib/schemas";
import type { SlowroastScore } from "@/lib/scoring";
import { FindingWithValidatedFeatureSchema } from "@/lib/vercel-features";

// two schemas here, on purpose. the model-facing one is permissive about the
// one shape sonnet refuses to emit correctly, the downstream one is strict +
// canonical. runSynth coerces between them.
//
// background: eval run 2026-04-19 showed sonnet systematically emitting
// relatedFindings values as bare strings ("gtm-blocking-render") instead of
// arrays. every single exhausted-retry failure had the same zodIssue shape:
// expected array, received string, path ["relatedFindings", "<id>"]. retry
// doesnt help - same inputs, same mistake. loosening to accept string|string[]
// at the model layer and coercing to string[] before handoff is lossless
// (a single-element array means the same thing as a single string) and
// matches the pattern we already use for url + generatedAt.
//
// url + generatedAt are stamped in code after validation anyway, no reason
// to let the model mangle an iso timestamp or echo a url we already have.
// findings use the strict feature-id-validated shape so zod rejects a
// hallucinated catalog entry at parse time.
const ModelSynthOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  topPriority: FindingWithValidatedFeatureSchema.optional(),
  findings: z.array(FindingWithValidatedFeatureSchema),
  relatedFindings: z
    .record(z.string(), z.union([z.array(z.string()), z.string()]))
    .optional(),
});

export const SynthOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  topPriority: FindingWithValidatedFeatureSchema.optional(),
  findings: z.array(FindingWithValidatedFeatureSchema),
  relatedFindings: z.record(z.string(), z.array(z.string())).optional(),
});
export type SynthOutput = z.infer<typeof SynthOutputSchema>;

// the CONSTRAINTS block below requires preserving vercelFeatureId / category
// / evidence / affectedResources verbatim from the inputs. sonnet's job here
// is prioritization + prose, not re-grounding the catalog (specialists did
// that under strict prompt + tool constraints). the strict schema enforces
// catalog integrity, the prompt enforces preservation
const INSTRUCTIONS = `You are the synthesizer in a multi-agent web-performance analyzer. Four specialist analysts (image, bundle, cache, cwv) have already produced grounded findings from PageSpeed Insights data; your job is to integrate their outputs into a single prioritized remediation report for an engineering lead at a Vercel-ICP company.

ROLE
You do not detect problems — the specialists already did. You prioritize, narrate, and select. You decide which finding is the single most important fix (topPriority) and which others round out the report.

AUDIENCE & VOICE
The reader is a technical engineering lead — comfortable with code and deploys, but not necessarily living in web-performance acronyms daily. Write so they get real value on a first read without a lookup table:
- On first mention, expand each acronym in plain language. "Largest Contentful Paint (LCP, how fast the main content appears)", "Interaction to Next Paint (INP, how quickly the page responds to input)", "Cumulative Layout Shift (CLS, how much the layout jumps while loading)". Use the acronym alone on subsequent mentions in the same summary.
- Prefer plain framing for other jargon on first use: say "blocking JavaScript that delays first paint" before or instead of "render-blocking scripts"; "time the page spends frozen on the main thread" instead of a bare "TBT" or "long tasks"; "making the React app interactive in the browser" instead of an unexplained "hydration cost".
- Concrete numbers, real file names, and specific URLs are welcome — those land harder than adjectives. Keep marketing voice, hype, and vague claims ("massive wins", "dramatic improvements") out.

PROCESS
1. Read the URL and each specialist's findings + summary.
2. Watch for a summary starting with "[specialist-failed]" — that lane could not run. Produce the report from the remaining lanes and explicitly mention the skipped lane(s) in executiveSummary. Do not invent findings for a failed specialist.
3. Rank all surviving findings by impact × ease. Impact is the estimatedImpact field (favor critical/high severity with large ms or byte savings); ease is roughly the effort implied by the Vercel feature's typical fix (component swap > config change > architectural change).
4. Pick topPriority: the single finding with the best impact-per-effort tradeoff. topPriority MUST also appear in findings[] — it is not a separate pool.
5. Emit findings[] ordered by severity (critical → high → medium → opportunity), then by confidence within severity. Cap at 10.
6. Write executiveSummary: 2–3 short paragraphs (not bullets). Paragraph 1: the overall picture — score posture, which specialist lanes flagged real issues, any skipped lane. Paragraph 2: what the team should do first (the topPriority rationale) and the second-order wins behind it. Optional paragraph 3: concrete next steps or caveats. Keep it concrete, data-grounded, and readable by someone who doesn't already speak fluent web-perf.

SCORING FRAMING
The prompt header includes a "Slowroast score" block when available — a gentler headline derived deterministically from the raw PageSpeed Insights performance score. When you reference a score in the executiveSummary, use the Slowroast score and its letter grade / band label from that header. Do NOT quote the raw PageSpeed Insights number in your summary — the UI renders it separately as a transparency footnote, so restating it mid-paragraph is redundant and makes the tone harsher than it needs to be. Specialist summaries still reference the raw PSI number; that's ground truth for their analysis and fine to cite as "the underlying Lighthouse signal," just don't put the bare "X/100" figure in the exec summary.

CONSTRAINTS
- Do NOT invent findings. Every finding in your output MUST originate from a specialist input.
- vercelFeatureId, category, affectedResources, and evidence MUST be preserved verbatim from the source finding — do not alter them. You may lightly rewrite title or estimatedImpact wording for report-level consistency, but keep the substance.
- If findings[] is empty (no specialist produced anything), omit topPriority entirely — do not fabricate one. The executiveSummary should say the site is in good shape and call out per-lane posture from the specialist summaries.
- severity values are one of: critical, high, medium, opportunity. Confidence is a number in [0, 1]; preserve it.
- Hard cap 10 findings in the output. Drop the lowest-ranked if specialists collectively produced more.
- relatedFindings is optional and should usually be omitted for v1 — specialists have tight scope boundaries and same-root-cause duplicates are rare. Only populate it if you see two findings from different lanes that truly describe the same root cause.
- executiveSummary is prose in plain text. No markdown headings, no bullet lists, no "TL;DR" preambles.`;

// retry policy: 3 attempts, linear backoff. the initial eval run (2026-04-19)
// had 10/12 failures as NoObjectGeneratedError scattered across 6 of 7 URLs,
// same inputs succeeding some runs and failing others - non-systematic
// variance, exactly what resampling is for. schema + prompt stay unchanged,
// the captured attempt history tells us if we later need to look at a
// specific field
const MAX_SYNTH_ATTEMPTS = 3;
const SYNTH_RETRY_BASE_DELAY_MS = 500;

// cap the attempt record size. 2 KiB is enough to see malformed fields or
// enum near-misses without bloating results.json
const RAW_TEXT_CAP_BYTES = 2048;

export interface SynthAttempt {
  // 1-based so log lines read naturally ("attempt 1/3 failed").
  attemptIndex: number;
  outcome: "success" | "failure";
  durationMs: number;
  // Present only on failures. Sonnet's raw text (truncated) is what actually
  // tells us which field the model got wrong — "No object generated" alone is
  // not diagnostic.
  rawText?: string;
  // Present only when the cause is a ZodError (schema validation failure).
  // Other NoObjectGeneratedError causes (JSON parse errors, tool-call-mode
  // variants) will be missing this — rawText still carries the payload.
  zodIssues?: unknown[];
  // Present only on failures. The flattened Error.message for quick scanning.
  errorMessage?: string;
}

export interface SynthResult {
  output: SynthOutput;
  attempts: SynthAttempt[];
}

// Surfaced when all MAX_SYNTH_ATTEMPTS exhaust. Carries the full attempt
// history so pipeline.ts can bubble it into PipelineError and the eval
// harness persists it verbatim.
export class SynthFailedError extends Error {
  readonly attempts: SynthAttempt[];
  readonly cause?: unknown;
  constructor(message: string, attempts: SynthAttempt[], cause?: unknown) {
    super(message);
    this.name = "SynthFailedError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export interface RunSynthOptions {
  signal?: AbortSignal;
  // optional slowroast score to surface in the synth prompt header. when set,
  // sonnet frames the exec summary around the curved number + grade instead
  // of raw PSI. if PSI didnt return a score we just omit the block
  slowroastScore?: SlowroastScore;
}

export async function runSynth(
  url: string,
  outputs: SpecialistOutput[],
  opts: RunSynthOptions = {},
): Promise<SynthResult> {
  const attempts: SynthAttempt[] = [];
  const prompt = buildSynthPrompt(url, outputs, opts.slowroastScore);

  for (let i = 1; i <= MAX_SYNTH_ATTEMPTS; i++) {
    if (opts.signal?.aborted) {
      throw new SynthFailedError(
        "synth aborted before attempt",
        attempts,
        opts.signal.reason,
      );
    }

    const startedAt = Date.now();
    try {
      const { object } = await generateObject({
        model: gateway("anthropic/claude-sonnet-4.6"),
        schema: ModelSynthOutputSchema,
        system: INSTRUCTIONS,
        prompt,
        abortSignal: opts.signal,
        providerOptions: {
          gateway: { order: ["anthropic", "openai"] },
        },
      });
      const output = coerceSynthOutput(object);
      attempts.push({
        attemptIndex: i,
        outcome: "success",
        durationMs: Date.now() - startedAt,
      });
      return { output, attempts };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      attempts.push(buildFailureAttempt(i, durationMs, err));

      // Caller-driven cancellation (upstream timeout or client disconnect):
      // don't burn further attempts, surface immediately with the one
      // failure recorded.
      if (opts.signal?.aborted) {
        throw new SynthFailedError(
          `synth aborted during attempt ${i}`,
          attempts,
          err,
        );
      }

      // Non-schema failures (gateway 5xx, network) shouldn't retry blindly.
      // The AI SDK's own network retry has already run by the time we see
      // this error; re-calling generateObject repeats any transient work
      // without new information.
      if (!NoObjectGeneratedError.isInstance(err)) {
        throw new SynthFailedError(
          `synth attempt ${i} failed with non-schema error: ${errorMessage(err)}`,
          attempts,
          err,
        );
      }

      if (i === MAX_SYNTH_ATTEMPTS) {
        throw new SynthFailedError(
          `synth failed after ${MAX_SYNTH_ATTEMPTS} attempts: all NoObjectGeneratedError`,
          attempts,
          err,
        );
      }

      // Linear backoff: 500ms after attempt 1, 1000ms after attempt 2.
      // Short enough to fit in the phase timeout alongside actual synth time,
      // long enough to avoid hammering the gateway.
      await sleep(i * SYNTH_RETRY_BASE_DELAY_MS);
    }
  }

  // Defensive: the loop always returns or throws above.
  throw new SynthFailedError("synth loop exited unexpectedly", attempts);
}

function buildFailureAttempt(
  attemptIndex: number,
  durationMs: number,
  err: unknown,
): SynthAttempt {
  const attempt: SynthAttempt = {
    attemptIndex,
    outcome: "failure",
    durationMs,
    errorMessage: errorMessage(err),
  };

  if (NoObjectGeneratedError.isInstance(err)) {
    if (typeof err.text === "string" && err.text.length > 0) {
      attempt.rawText = truncate(err.text, RAW_TEXT_CAP_BYTES);
    }
    // The AI SDK wraps ZodError in TypeValidationError, so the real .issues
    // array lives one level deeper (NoObjectGeneratedError.cause →
    // TypeValidationError.cause → ZodError). We walk up to 4 hops looking
    // for any cause with a structured issues array — duck-typed to stay
    // tolerant of SDK/zod internals drift.
    const issues = findZodIssues(err.cause);
    if (issues) attempt.zodIssues = issues;
  }

  return attempt;
}

// Convert a permissive model output into the canonical SynthOutput shape by
// wrapping any bare-string relatedFindings value into a single-element array.
// No-op when relatedFindings is absent or already canonical. Logs the coercion
// count so we can see how often Sonnet emits the bare-string form in the
// wild — relevant signal for whether to eventually retire the union.
function coerceSynthOutput(
  model: z.infer<typeof ModelSynthOutputSchema>,
): SynthOutput {
  if (!model.relatedFindings) {
    return {
      executiveSummary: model.executiveSummary,
      topPriority: model.topPriority,
      findings: model.findings,
    };
  }

  const coerced: Record<string, string[]> = {};
  let coercionsFired = 0;
  for (const [key, value] of Object.entries(model.relatedFindings)) {
    if (typeof value === "string") {
      coerced[key] = [value];
      coercionsFired++;
    } else {
      coerced[key] = value;
    }
  }

  if (coercionsFired > 0) {
    console.error(
      `[synth] coerced ${coercionsFired} bare-string value(s) in relatedFindings → single-element array(s)`,
    );
  }

  return {
    executiveSummary: model.executiveSummary,
    topPriority: model.topPriority,
    findings: model.findings,
    relatedFindings: coerced,
  };
}

function findZodIssues(cause: unknown, depth = 0): unknown[] | undefined {
  if (depth > 4 || !cause || typeof cause !== "object") return undefined;
  if ("issues" in cause) {
    const issues = (cause as { issues: unknown }).issues;
    if (Array.isArray(issues)) return issues;
  }
  if ("cause" in cause) {
    return findZodIssues((cause as { cause: unknown }).cause, depth + 1);
  }
  return undefined;
}

function truncate(s: string, byteCap: number): string {
  // UTF-8 surrogate safety: cap by codepoint rather than byte index so we
  // never split a multi-byte character. `byteCap` is treated as an
  // approximate upper bound — close enough for a 2 KiB display cap.
  if (s.length <= byteCap) return s;
  return s.slice(0, byteCap) + `…[truncated, ${s.length - byteCap} more chars]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildSynthPrompt(
  url: string,
  outputs: SpecialistOutput[],
  slowroastScore?: SlowroastScore,
): string {
  const lines: string[] = [];
  lines.push(`URL: ${url}`);
  if (slowroastScore) {
    // header block the SCORING FRAMING section of the prompt references.
    // named so sonnet picks it up instead of falling back on the raw PSI
    // number from the specialist summaries
    lines.push(
      `Slowroast score: ${slowroastScore.score}/100 — grade ${slowroastScore.grade} ("${slowroastScore.band}")${
        slowroastScore.psiRaw != null
          ? ` (derived from raw PageSpeed Insights performance score ${slowroastScore.psiRaw}/100)`
          : ""
      }`,
    );
  }
  lines.push("");
  lines.push(
    `The four specialist outputs follow. Each block has a SUMMARY and a FINDINGS list. A summary prefixed "[specialist-failed]" means that lane could not complete — treat its findings as absent and name the skipped lane in executiveSummary.`,
  );
  lines.push("");

  for (const out of outputs) {
    lines.push(`## ${out.specialist.toUpperCase()} specialist`);
    lines.push(`SUMMARY: ${out.summary}`);
    if (out.findings.length === 0) {
      lines.push("FINDINGS: (none)");
    } else {
      lines.push("FINDINGS:");
      for (let i = 0; i < out.findings.length; i++) {
        lines.push(formatFinding(i + 1, out.findings[i]));
      }
    }
    lines.push("");
  }

  lines.push(
    "Produce the synthesized report now. Preserve vercelFeatureId, category, affectedResources, and evidence verbatim from the source findings. Rank by impact × ease. Pick topPriority from findings[]. Write executiveSummary as 2–3 prose paragraphs.",
  );

  return lines.join("\n");
}

function formatFinding(n: number, f: Finding): string {
  const parts: string[] = [];
  parts.push(`${n}. [${f.severity}, conf=${f.confidence.toFixed(2)}] ${f.title}`);
  parts.push(`   impact: ${f.estimatedImpact}`);
  parts.push(`   vercelFeatureId: ${f.vercelFeatureId}`);
  parts.push(`   category: ${f.category}`);
  parts.push(`   affectedResources: ${JSON.stringify(f.affectedResources)}`);
  parts.push(`   evidence: ${f.evidence}`);
  parts.push(`   id: ${f.id}`);
  return parts.join("\n");
}
