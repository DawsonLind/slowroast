import { NextRequest } from "next/server";
import { z } from "zod";
import { runAnalysis, PipelineError } from "@/lib/pipeline";

// Node is the default runtime (Cache Components doesn't support Edge, and our
// PSI/HTML fetch + Node SDKs expect Node). Under `cacheComponents: true`, the
// route is dynamic by default — anything not inside `'use cache'` runs
// per-request, which is exactly what we want for per-URL analyses. Next.js 16
// rejects both `export const runtime` and `export const dynamic` alongside
// cacheComponents, so we rely on defaults and let the config drive behavior.
// 120s covers the observed phase budget: 30s PSI + 2×40s specialists
// (serialized by p-limit(2)) + 30s synth, with slack. Synth grew from 15s
// to 30s after empirical measurement showed Sonnet 4.6 consistently needs
// ~15s+ for ReportSchema structured output. See docs/architecture.md §2
// and lib/pipeline.ts budgets.
export const maxDuration = 120;

const BodySchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let parsedBody: z.infer<typeof BodySchema>;
  try {
    const json: unknown = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    parsedBody = parsed.data;
  } catch (err) {
    return Response.json(
      { error: "invalid_json", message: errorMessage(err) },
      { status: 400 },
    );
  }

  try {
    const result = await runAnalysis(parsedBody.url, { signal: req.signal });
    return Response.json(result);
  } catch (err) {
    if (err instanceof PipelineError) {
      return Response.json(
        { error: err.kind, message: err.message },
        { status: statusForPipelineError(err.kind) },
      );
    }
    console.error("[api/analyze] unexpected error:", err);
    return Response.json(
      { error: "internal", message: errorMessage(err) },
      { status: 500 },
    );
  }
}

function statusForPipelineError(kind: PipelineError["kind"]): number {
  switch (kind) {
    // Upstream data source failure — 502 is the conventional "bad gateway"
    // signal, preserved so clients can distinguish it from our own bugs.
    case "psi":
      return 502;
    // All four specialists failed — model gateway is effectively down for us.
    case "all_specialists_failed":
    case "synth":
      return 502;
    // Caller disconnect — 499 in nginx-world, 408 as a standard-ish fallback.
    case "aborted":
      return 499;
    default:
      return 500;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
