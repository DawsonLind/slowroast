# Slowroast — Project Memory

Multi-agent web performance analyzer. Vercel Solutions Architect take-home. Built on Vercel, with Vercel, for Vercel customers.

**Always read `@docs/architecture.md` before making architectural decisions. Never deviate from that doc's design choices without flagging the deviation explicitly.**

---

## What this is

User pastes a URL. We produce a prioritized performance remediation plan in ~90 seconds. Every finding maps to a specific Vercel feature with a link to the docs.

**Audience:** engineering leads at Vercel-ICP companies (Next.js shops, mid-market e-commerce, dev-first SaaS).

**Business frame:** replaces a full day of senior-engineer perf audit work with a 90-second tool. The recommendations ARE the Vercel product pitch.

---

## Architecture (the one-line version)

```
URL → [PSI + HTML fetch in parallel]
    → [4 specialist ToolLoopAgents in parallel: image, bundle, cache, cwv]
    → [generateObject synthesizer with Zod schema + streamText summary]
    → Prioritized report, each finding linked to a Vercel feature
```

Each specialist is a `ToolLoopAgent` (AI SDK 6). Parallelism is `Promise.all` in the route handler — **not** an orchestrator agent. Synthesis is `generateObject`, not a tool-loop.

**Design principle:** Facts from data sources, recommendations from a curated catalog, judgment from LLMs. The agent cannot recommend a Vercel feature outside the catalog in `lib/vercel-features.ts`.

Full architecture in `@docs/architecture.md`. Read it. Do not invent alternatives.

---

## Tech stack (non-negotiable)

- **Next.js 16** with `cacheComponents: true` in `next.config.ts`
- **AI SDK 6** — `ToolLoopAgent`, `tool()`, `generateObject`, `streamText`
- **Vercel AI Gateway** — `anthropic/claude-haiku-4.5` for specialists, `anthropic/claude-sonnet-4.6` for synthesis, `openai/gpt-5.4` fallback
- **PageSpeed Insights API** for Lighthouse data
- **Zod** for all schema boundaries
- **Tailwind + shadcn/ui** for UI
- **No database for v1** — `use cache` + `cacheTag` for persistence

---

## File structure

```
app/
  page.tsx                        # Landing — PPR, static shell + Suspense island
  analyze/page.tsx                # Analysis UI with streaming
  evals/page.tsx                  # Eval dashboard — 'use cache' + cacheTag('eval-run')
  api/analyze/route.ts            # Streaming agent orchestration
lib/
  vercel-features.ts              # THE CATALOG. Recommendations must resolve here.
  psi.ts                          # PageSpeed Insights wrapper
  html.ts                         # Direct HTML + header fetch, graceful WAF handling
  data-slice.ts                   # Per-specialist data extraction from combined PSI+HTML
  agents/
    image.ts                      # Image specialist ToolLoopAgent
    bundle.ts                     # JS bundle specialist
    cache.ts                      # Cache/delivery specialist
    cwv.ts                        # Core Web Vitals specialist
    shared-tools.ts               # lookup_vercel_feature + any cross-agent tools
  synth.ts                        # generateObject synthesizer + streamText summary
  schemas.ts                      # Zod: Finding, Report, specialist outputs
scripts/
  eval.ts                         # Eval harness
evals/
  golden/*.json                   # Hand-labeled URLs
  results/*.json                  # Run outputs
  latest.json                     # Pointer to latest run
docs/
  architecture.md                 # Full prep doc — canonical reference
.claude/
  skills/
    create-specialist-agent/      # Pattern for adding a new specialist
```

---

## Coding conventions

- TypeScript strict mode. No `any`. Use `unknown` and narrow.
- Zod at every I/O boundary: PSI response, HTML parse, agent outputs, synthesizer output, API route input.
- Comments explain *why*, not *what*. Especially at design decision points — those comments are demo material.
- No barrel files (`index.ts` re-exports). Import from the direct path.
- File naming: kebab-case files, PascalCase for React components.
- Server Components by default. `"use client"` only where interaction actually requires it.
- One component per file.
- Tailwind utility classes first; extract to components when used 3+ times.

---

## How to work with this codebase

**Before writing code:**
1. Re-read the relevant section of `@docs/architecture.md`.
2. If the task is non-trivial (multi-file, new pattern, architecture-touching), propose a plan and wait for approval. Don't batch multiple unrelated changes.
3. Check if there's a skill for this: `/create-specialist-agent` for new specialists, for example.

**While writing code:**
- Use the Vercel MCP to look up current Vercel docs rather than guessing from training data.
- Use Context7 for current AI SDK 6 and Next.js 16 API shapes — both are new enough that training may be wrong.
- Use shadcn MCP to install components correctly rather than hand-writing them.

**After writing code:**
- Run typecheck (`npm run typecheck`) before claiming done.
- For agent changes, mention whether eval needs to rerun.
- Surface design decisions in the commit message, not buried in diffs.

---

## Things you should push back on

- Adding a database. V1 is stateless. Postgres is a week-2 feature.
- Adding an orchestrator agent. Parallelism is `Promise.all`.
- Using Sonnet for specialists. Haiku is the choice. Cost/latency story matters.
- Adding `any` types. Use `unknown` and narrow.
- Adding features not in the prep doc's MVP scope without asking.
- Running heavy work in middleware/edge — Cache Components doesn't support Edge.

---

## Things you should just do (no need to ask)

- Fixing type errors you encounter in passing.
- Adding `aria-*` attributes for accessibility.
- Writing short, clear comments at design-decision points.
- Adding an error boundary if one's missing on a new route.
- Choosing between named/default exports per existing convention in the file.

---

## When to ask vs proceed

**Ask first:**
- Architecture changes (new agents, new topology, new data sources)
- Adding a new dependency
- Changing Zod schemas that other files depend on
- Anything that touches the Vercel Feature Catalog structure

**Just proceed:**
- Implementing a specialist following the existing pattern
- Adding UI polish on existing components
- Writing tests / eval entries
- Styling and copy tweaks

---

## Glossary

- **Specialist** — one of four `ToolLoopAgent` instances (image, bundle, cache, cwv)
- **Synthesizer** — `generateObject` call that combines specialist outputs into the final report
- **Catalog** — `lib/vercel-features.ts`, the curated list of Vercel features findings can reference
- **Finding** — a single detected issue with severity, confidence, affected resource, Vercel feature mapping
- **Golden set** — the 7 URLs in `evals/golden/` used for regression
- **Deterministic layer** — the non-LLM data-fetching phase (PSI + HTML)

---

*When in doubt, the prep doc in `@docs/architecture.md` is the source of truth. This file (`CLAUDE.md`) is its executive summary.*
