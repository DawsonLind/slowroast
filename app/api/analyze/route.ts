import { NextRequest } from "next/server";
import { z } from "zod";
import { runAnalysis, PipelineError } from "@/lib/pipeline";
import type { ProgressEvent } from "@/lib/progress-events";

// node runtime by default - cache components doesnt support edge, and our
// PSI/HTML fetch path plus the node SDKs expect node anyway. with
// `cacheComponents: true` the route is dynamic unless its inside `'use cache'`,
// which is exactly what we want for per-URL analyses. next.js 16 rejects
// both `export const runtime` and `export const dynamic` alongside
// cacheComponents, so we skip the explicit exports and let the config drive
// everything.
//
// 240s covers the worst-case phase envelope: 60s PSI + 2x40s specialists
// (serialized by p-limit(2)) + 90s synth + a bit of slack. the PSI and
// synth caps were both rebased on 2026-04-19 from the 7-URL eval
// (evals/results.json):
//   PSI    30s -> 60s  (eval p95 = 45s; old cap timed out 37% of runs)
//   synth  30s -> 90s  (eval p95 = 70s; old cap timed out 58% of runs)
// pro-plan vercel functions go up to 800s so theres headroom, but bounding
// client-perceived hangs matters more than stretching the cap. real e2e
// p95 from the eval was ~141s - well under this.
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

  // progress events stream as newline-delimited JSON. once the stream is
  // open we always return 200 and surface pipeline errors as in-band
  // {type:"error"} events - you cant flip the HTTP status mid-stream, and
  // mapping partial failures onto status codes isnt work the client needs
  // to do. body-validation errors above this block still go out as JSON/400.
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
      // proxies and CDNs will happily buffer a streaming body - this header
      // tells them not to. vercel honors it.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
