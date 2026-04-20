import Link from "next/link";
import { Analyzer } from "./_components/analyzer";
import { BrandMark } from "./_components/brand-mark";

// PPR under cacheComponents: the page shell is fully static (no dynamic APIs,
// no uncached awaits), so Next.js prerenders it at build time. The Analyzer is
// a client component that hydrates and executes entirely in the browser — it
// holds the dynamic parts (form state, POST to /api/analyze, report render).
// This gives us a static-HTML-first-paint with an interactive island, without
// needing a Suspense boundary (there's no server-side async work to await).
export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="flex flex-col gap-4">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Prioritized web perf remediation in ~90 seconds.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
            Paste a URL. Four specialist agents fan out in parallel across
            PageSpeed Insights and raw HTML, then a synthesizer ranks their
            findings by impact × ease. Every recommendation is grounded in a
            curated Vercel feature catalog — no hallucinated fixes.
          </p>
        </section>

        <Analyzer />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandMark />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Slowroast
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            multi-agent web perf analyzer
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/evals"
            className="rounded-sm px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Evals
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Vercel SA take-home · Claude Haiku 4.5 specialists · Sonnet 4.6 synth
        </span>
        <span className="flex items-center gap-3">
          <span>Next.js 16 · AI SDK 6 · Fluid Compute</span>
          <span className="text-border">·</span>
          <a
            href="https://github.com/DawsonLind/slowroast"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub ↗
          </a>
        </span>
      </div>
    </footer>
  );
}
