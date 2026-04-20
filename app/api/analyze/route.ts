import { NextRequest } from "next/server";
import { z } from "zod";
import { runAnalysis, PipelineError } from "@/lib/pipeline";
import type { ProgressEvent } from "@/lib/progress-events";

// Node is the default runtime (Cache Components doesn't support Edge, and our
// PSI/HTML fetch + Node SDKs expect Node). Under `cacheComponents: true`, the
// route is dynamic by default — anything not inside `'use cache'` runs
// per-request, which is exactly what we want for per-URL analyses. Next.js 16
// rejects both `export const runtime` and `export const dynamic` alongside
// cacheComponents, so we rely on defaults and let the config drive behavior.
//
// 240s covers the worst-case phase envelope: 60s PSI + 2×40s specialists
// (serialized by p-limit(2)) + 90s synth + ~10s slack. Both PSI and synth
// caps were rebased on 2026-04-19 from the 7-URL eval distribution
// (evals/results.json):
//   PSI    30s → 60s  (eval p95 = 45s; old cap timed out 37% of runs)
//   synth  30s → 90s  (eval p95 = 70s; old cap timed out 58% of runs)
// Pro-plan Vercel functions allow up to 800s; 240s leaves headroom while
// keeping client-perceived hangs bounded. Real e2e p95 from the eval was
// ~141s — well under this cap.
export const maxDuration = 240;

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

  // Stream progress events as newline-delimited JSON. Once the stream is
  // open we always return HTTP 200 and surface pipeline errors as in-band
  // {type: "error"} events — flipping the HTTP status mid-stream isn't
  // possible, and matching status codes to partial failures is an exercise
  // the client doesn't need. Body-validation errors above stay JSON / 400.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      (async () => {
        try {
          const result = await runAnalysis(parsedBody.url, {
            signal: req.signal,
            onEvent: write,
          });
          write({ type: "result", result });
        } catch (err) {
          if (err instanceof PipelineError) {
            write({ type: "error", kind: err.kind, message: err.message });
          } else {
            console.error("[api/analyze] unexpected error:", err);
            write({
              type: "error",
              kind: "internal",
              message: errorMessage(err),
            });
          }
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Proxies/CDNs will happily buffer a streaming body; this hint tells
      // them not to. Vercel's platform honors it.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
