import {
  PsiResponseSchema,
  type PsiLighthouseResult,
} from "@/lib/schemas";

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// Arch doc §7/§12 expect PSI to run in the 10–30s range. 30s caps the wait so
// a hung upstream can't stall the whole agent pipeline; the API route degrades
// to direct-fetch-only results in that case.
const DEFAULT_TIMEOUT_MS = 30_000;

export type PsiStrategy = "mobile" | "desktop";

export interface FetchPsiOptions {
  strategy?: PsiStrategy;
  signal?: AbortSignal;
  // Override the 30s default. The API route should keep the default to fail
  // fast; manual/eval harnesses may want a longer cap since PSI's run-time
  // varies meaningfully under real-world load.
  timeoutMs?: number;
}

export type PsiErrorKind =
  | "timeout"
  | "rate_limit"
  | "http_error"
  | "schema_mismatch"
  | "missing_api_key"
  | "network_error";

export class PsiError extends Error {
  readonly kind: PsiErrorKind;
  readonly status?: number;

  constructor(kind: PsiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "PsiError";
    this.kind = kind;
    this.status = status;
  }
}

export async function fetchPsi(
  url: string,
  opts: FetchPsiOptions = {},
): Promise<PsiLighthouseResult> {
  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) {
    throw new PsiError(
      "missing_api_key",
      "PSI_API_KEY is not set; cannot call PageSpeed Insights",
    );
  }

  const strategy = opts.strategy ?? "mobile";
  const endpoint = new URL(PSI_ENDPOINT);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new PsiError("timeout", `PSI timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  // Thread the caller's AbortSignal through so route-level cancellation wins.
  opts.signal?.addEventListener("abort", () => controller.abort(opts.signal?.reason), {
    once: true,
  });

  let response: Response;
  try {
    response = await fetch(endpoint, { signal: controller.signal });
  } catch (err) {
    if (err instanceof PsiError) throw err;
    if (isAbortError(err)) {
      throw new PsiError("timeout", `PSI request aborted: ${errorMessage(err)}`);
    }
    throw new PsiError("network_error", `PSI fetch failed: ${errorMessage(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new PsiError("rate_limit", "PSI rate limit hit", 429);
  }
  if (!response.ok) {
    throw new PsiError(
      "http_error",
      `PSI responded ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const json: unknown = await response.json();
  const parsed = PsiResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new PsiError(
      "schema_mismatch",
      `PSI response did not match expected shape: ${parsed.error.message}`,
    );
  }

  return parsed.data.lighthouseResult;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
