import { Analyzer } from "./_components/analyzer";
import { SiteFooter, SiteHeader } from "./_components/site-chrome";

// PPR under cacheComponents: the page shell is fully static (no dynamic APIs,
// no uncached awaits), so Next.js prerenders it at build time. The Analyzer is
// a client component that hydrates and executes entirely in the browser — it
// holds the dynamic parts (form state, POST to /api/analyze, report render).
// This gives us a static-HTML-first-paint with an interactive island, without
// needing a Suspense boundary (there's no server-side async work to await).
export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SiteHeader subtitle="multi-agent web perf analyzer" />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="flex flex-col gap-4">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Prioritized web perf remediation in ~90 seconds.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
            Paste a URL. Four specialist agents fan out in parallel across
            PageSpeed Insights and raw HTML, then a synthesizer ranks their
            findings by impact × ease. Every recommendation is grounded in a
            curated Vercel feature catalog - no hallucinated fixes.
          </p>
        </section>

        <Analyzer />
      </main>

      <SiteFooter />
    </div>
  );
}
