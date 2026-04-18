import { parse, type HTMLElement } from "node-html-parser";
import type { HtmlFetchResult } from "@/lib/schemas";

// Keep the UA plain-browser-ish. Bot-evasion tricks are out of scope for v1 —
// if a site WAFs us we degrade gracefully (see §7/§12 of docs/architecture.md).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 10_000;

// Headers the cache/delivery specialist will consume. We lowercase when we
// copy them, but we pass everything the upstream returned — keys are cheap.
const HEADER_ALLOWLIST: readonly string[] = [
  "cache-control",
  "etag",
  "age",
  "content-type",
  "content-encoding",
  "content-length",
  "server",
  "x-powered-by",
  "x-vercel-cache",
  "x-vercel-id",
  "cf-cache-status",
  "cf-ray",
  "via",
  "vary",
  "last-modified",
];

export interface FetchHtmlOptions {
  signal?: AbortSignal;
}

export async function fetchHtml(
  url: string,
  opts: FetchHtmlOptions = {},
): Promise<HtmlFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  opts.signal?.addEventListener("abort", () => controller.abort(opts.signal?.reason), {
    once: true,
  });

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    const headers = collectHeaders(response.headers);

    // Treat WAF-flavored responses as "blocked" rather than exceptions so the
    // specialists still run with reduced confidence.
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return {
        url,
        finalUrl: response.url || url,
        status: response.status,
        headers,
        html: null,
        blocked: true,
        reason: `http_${response.status}`,
      };
    }
    if (!response.ok) {
      return {
        url,
        finalUrl: response.url || url,
        status: response.status,
        headers,
        html: null,
        blocked: true,
        reason: `http_${response.status}`,
      };
    }

    const html = await response.text();
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      headers,
      html,
      blocked: false,
    };
  } catch (err) {
    const reason = isAbortError(err)
      ? "timeout"
      : `network_error:${errorMessage(err)}`;
    return {
      url,
      finalUrl: url,
      status: 0,
      headers: {},
      html: null,
      blocked: true,
      reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Asset extraction. Pure over an HTML string — trivially fixture-testable and
// the shape Day 2's data-slice will forward to specialists.
// ---------------------------------------------------------------------------

export interface ImgAsset {
  src: string | null;
  srcset: string | null;
  loading: string | null;
  fetchpriority: string | null;
  width: string | null;
  height: string | null;
  alt: string | null;
  // Rendered next/image marker (set by the runtime component). Lets the image
  // specialist distinguish "raw <img>" from "next/image produced this".
  isNextImage: boolean;
}

export interface ScriptAsset {
  src: string | null;
  async: boolean;
  defer: boolean;
  type: string | null;
  // next/script sets data-nscript="<strategy>" on the rendered tag.
  nextScriptStrategy: string | null;
}

export interface LinkAsset {
  href: string | null;
  rel: string | null;
  as: string | null;
  crossorigin: string | null;
}

export interface ParsedAssets {
  images: ImgAsset[];
  scripts: ScriptAsset[];
  preloads: LinkAsset[];
  stylesheets: LinkAsset[];
  title: string | null;
}

export function parseHtmlForAssets(html: string): ParsedAssets {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });

  const images: ImgAsset[] = root.getElementsByTagName("img").map((el) => ({
    src: attr(el, "src"),
    srcset: attr(el, "srcset"),
    loading: attr(el, "loading"),
    fetchpriority: attr(el, "fetchpriority"),
    width: attr(el, "width"),
    height: attr(el, "height"),
    alt: attr(el, "alt"),
    isNextImage: el.getAttribute("data-nimg") != null,
  }));

  const scripts: ScriptAsset[] = root.getElementsByTagName("script").map((el) => ({
    src: attr(el, "src"),
    async: el.getAttribute("async") != null,
    defer: el.getAttribute("defer") != null,
    type: attr(el, "type"),
    nextScriptStrategy: attr(el, "data-nscript"),
  }));

  const linkEls = root.getElementsByTagName("link");
  const preloads: LinkAsset[] = linkEls
    .filter((el) => (el.getAttribute("rel") || "").toLowerCase() === "preload")
    .map(toLinkAsset);
  const stylesheets: LinkAsset[] = linkEls
    .filter((el) => (el.getAttribute("rel") || "").toLowerCase() === "stylesheet")
    .map(toLinkAsset);

  const titleEl = root.getElementsByTagName("title")[0];
  const title = titleEl ? titleEl.text.trim() || null : null;

  return { images, scripts, preloads, stylesheets, title };
}

function toLinkAsset(el: HTMLElement): LinkAsset {
  return {
    href: attr(el, "href"),
    rel: attr(el, "rel"),
    as: attr(el, "as"),
    crossorigin: attr(el, "crossorigin"),
  };
}

function attr(el: HTMLElement, name: string): string | null {
  const v = el.getAttribute(name);
  return v == null ? null : v;
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADER_ALLOWLIST) {
    const v = headers.get(name);
    if (v != null) out[name] = v;
  }
  return out;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
