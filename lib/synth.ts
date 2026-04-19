import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import type { Finding, SpecialistOutput } from "@/lib/schemas";
import { FindingWithValidatedFeatureSchema } from "@/lib/vercel-features";

// Strict subset of ReportSchema that the MODEL emits. url + generatedAt are
// stamped in code after validation — no reason to let the model mangle an ISO
// timestamp or echo a URL that's already in our hand. Findings use the strict
// feature-id-validated shape so Zod rejects a hallucinated catalog entry at
// parse time instead of shipping a broken report downstream.
const SynthOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  topPriority: FindingWithValidatedFeatureSchema.optional(),
  findings: z.array(FindingWithValidatedFeatureSchema),
  relatedFindings: z
    .record(z.string(), z.array(FindingWithValidatedFeatureSchema))
    .optional(),
});
export type SynthOutput = z.infer<typeof SynthOutputSchema>;

// Per CONSTRAINTS: preserve vercelFeatureId / category / evidence / affected
// resources verbatim from the inputs. The Sonnet synthesizer's value is
// prioritization and prose — NOT re-grounding the catalog, which specialists
// already did under strict prompt + tool constraints. The strict schema
// enforces catalog integrity; the prompt enforces preservation.
const INSTRUCTIONS = `You are the synthesizer in a multi-agent web-performance analyzer. Four specialist analysts (image, bundle, cache, cwv) have already produced grounded findings from PageSpeed Insights data; your job is to integrate their outputs into a single prioritized remediation report for an engineering lead at a Vercel-ICP company.

ROLE
You do not detect problems — the specialists already did. You prioritize, narrate, and select. You decide which finding is the single most important fix (topPriority) and which others round out the report.

PROCESS
1. Read the URL and each specialist's findings + summary.
2. Watch for a summary starting with "[specialist-failed]" — that lane could not run. Produce the report from the remaining lanes and explicitly mention the skipped lane(s) in executiveSummary. Do not invent findings for a failed specialist.
3. Rank all surviving findings by impact × ease. Impact is the estimatedImpact field (favor critical/high severity with large ms or byte savings); ease is roughly the effort implied by the Vercel feature's typical fix (component swap > config change > architectural change).
4. Pick topPriority: the single finding with the best impact-per-effort tradeoff. topPriority MUST also appear in findings[] — it is not a separate pool.
5. Emit findings[] ordered by severity (critical → high → medium → opportunity), then by confidence within severity. Cap at 10.
6. Write executiveSummary: 2–3 short paragraphs (not bullets). Paragraph 1: the overall picture — score posture, which lanes flagged real issues, any skipped lane. Paragraph 2: what the team should do first (the topPriority rationale) and the second-order wins behind it. Keep it concrete, data-grounded, no marketing voice.

CONSTRAINTS
- Do NOT invent findings. Every finding in your output MUST originate from a specialist input.
- vercelFeatureId, category, affectedResources, and evidence MUST be preserved verbatim from the source finding — do not alter them. You may lightly rewrite title or estimatedImpact wording for report-level consistency, but keep the substance.
- If findings[] is empty (no specialist produced anything), omit topPriority entirely — do not fabricate one. The executiveSummary should say the site is in good shape and call out per-lane posture from the specialist summaries.
- severity values are one of: critical, high, medium, opportunity. Confidence is a number in [0, 1]; preserve it.
- Hard cap 10 findings in the output. Drop the lowest-ranked if specialists collectively produced more.
- relatedFindings is optional and should usually be omitted for v1 — specialists have tight scope boundaries and same-root-cause duplicates are rare. Only populate it if you see two findings from different lanes that truly describe the same root cause.
- executiveSummary is prose in plain text. No markdown headings, no bullet lists, no "TL;DR" preambles.`;

export interface RunSynthOptions {
  signal?: AbortSignal;
}

export async function runSynth(
  url: string,
  outputs: SpecialistOutput[],
  opts: RunSynthOptions = {},
): Promise<SynthOutput> {
  const { object } = await generateObject({
    model: gateway("anthropic/claude-sonnet-4.6"),
    schema: SynthOutputSchema,
    system: INSTRUCTIONS,
    prompt: buildSynthPrompt(url, outputs),
    abortSignal: opts.signal,
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });
  return object;
}

export function buildSynthPrompt(
  url: string,
  outputs: SpecialistOutput[],
): string {
  const lines: string[] = [];
  lines.push(`URL: ${url}`);
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
