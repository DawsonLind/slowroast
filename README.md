# Slowroast

**Multi-agent web performance analyzer.** Paste a URL, get a prioritized Vercel-grounded remediation plan in ~90 seconds.

Built as a Vercel Solutions Architect take-home — on Vercel, with Vercel, for Vercel customers.

---

## The problem

Every Vercel enterprise customer has the same conversation with leadership: "the site is too slow, we're losing conversion, what do we fix first?" Answering it well takes a senior performance engineer a full day of manual investigation — and by the time they're done, the priorities have drifted.

Slowroast replaces that day with 90 seconds. A customer pastes a URL and gets a ranked remediation roadmap where every finding is mapped to a specific Vercel feature, with docs links and estimated impact. The recommendations *are* the Vercel product pitch.

---

## Architecture

```
          URL
           │
           ▼
  ┌────────────────────────────────────────────┐
  │ Phase 1 — Deterministic data collection    │
  │   Promise.all([ fetchPSI, fetchHtml ])     │  ~5–15s
  │   No LLM. Facts only.                      │
  └────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────┐
  │ Phase 2 — Parallel specialist fan-out      │
  │                                            │
  │   Promise.all([                            │
  │     imageAgent.generate(),   ─┐            │
  │     bundleAgent.generate(),   │  Haiku 4.5 │  ~10–25s
  │     cacheAgent.generate(),    │  ToolLoop  │
  │     cwvAgent.generate(),    ─┘             │
  │   ])                                       │
  │                                            │
  │   Each specialist has a lookup_vercel_     │
  │   feature tool scoped to its category.     │
  └────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────┐
  │ Phase 3 — Synthesis                        │
  │   generateObject({                         │
  │     model: sonnet-4.6,                     │  ~15–25s
  │     schema: ReportSchema,                  │
  │   })                                       │
  │   Dedupe, prioritize by impact × ease.     │
  └────────────────────────────────────────────┘
           │
           ▼
   Prioritized report
   (critical / high / medium / opportunity,
    each with a Vercel feature + docs link)
```

### Why this shape

- **No orchestrator agent.** Parallelism is `Promise.all` in the route handler. A meta-agent for routing would add a token tax for logic vanilla code handles better — and would serialize what should be parallel.
- **Haiku 4.5 on specialists, Sonnet 4.6 on synthesis.** Specialists are narrow (one category, 2–3 tools); Haiku handles that cheaply and fast. Synthesis is judgment across four lanes — Sonnet earns its cost there.
- **Facts from data, recommendations from a catalog, judgment from LLMs.** The catalog in `lib/vercel-features.ts` is the "no hallucinated recommendations" guarantee. Each specialist's `lookup_vercel_feature` tool is physically scoped to its category at construction time, so a cross-category mis-recommendation is impossible — not prompted against, but structurally prevented.
- **Independent per-phase timeout budgets.** PSI = 30s, specialists = 40s, synth = 15s. A slow PSI causes a clean 502, not a silent downstream failure.
- **Graceful degradation.** A specialist crash becomes a `[specialist-failed]` marker in synth input; the synthesizer still names the lane in the executive summary. A zero-findings report is a valid product state — `topPriority` is optional in the schema.

---

## Tech stack

| Choice | Why |
|---|---|
| **Next.js 16** with `cacheComponents: true` | Dogfoods what the tool recommends. The landing is PPR (static shell + client analyzer island); `/evals` is `use cache` + `cacheTag('eval-run')`. |
| **AI SDK 6** — `ToolLoopAgent` × 4 + `generateObject` | Specialists are independent `ToolLoopAgent` instances. Synthesis is `generateObject` with a Zod schema — no tool loop, because all reasoning already happened in the specialists. |
| **Vercel AI Gateway** | One endpoint, per-agent model routing (`anthropic/claude-haiku-4.5` for specialists, `anthropic/claude-sonnet-4.6` for synth, `openai/gpt-5.4` failover). Unified observability and a one-line failover story. |
| **PageSpeed Insights API** | Google runs a real Lighthouse audit and returns structured JSON. Free, 25k queries/day with a key. Bundling Chromium into a serverless function would be the wrong trade. |
| **Raw `fetch` for HTML + headers** | Complements PSI with material PSI doesn't cleanly expose: response headers, `<img>` vs `<Image>` usage, `<script>` tag configuration. Degrades gracefully if a WAF blocks us. |
| **Zod everywhere** | At every I/O boundary: PSI, HTML, tool inputs, specialist outputs, synth output, route input. The catalog reference is enforced via a Zod `.refine()`. |
| **Tailwind + shadcn/ui** | Fast, clean, doesn't compete with the demo for attention. |
| **Fluid Compute (Vercel default)** | Four parallel agents spend ~95% of their wall-clock time waiting on model tokens. Active CPU Pricing makes that cheap. Traditional per-invocation serverless would be ~4× the cost for the same workload. |
| **No database (v1)** | Results cached via `use cache` + `cacheTag`. Eval results live in JSON in the repo. Postgres is a week-2 problem when per-customer history matters. |

---

## Run locally

```bash
# 1. Install
npm install

# 2. Environment
cp .env.example .env.local
# Fill in:
#   AI_GATEWAY_API_KEY — vercel.com/docs/ai-gateway
#   PSI_API_KEY        — developers.google.com/speed/docs/insights/v5/get-started
# Both are free.

# 3. Dev server
npm run dev
# → http://localhost:3000

# 4. Typecheck (strict, no `any`)
npm run typecheck
```

### Per-specialist scripts

Each specialist has a standalone harness for iterating on prompts without running the full pipeline:

```bash
npm run test:image     # image specialist in isolation
npm run test:bundle    # JS bundle specialist
npm run test:cache     # cache/delivery specialist
npm run test:cwv       # Core Web Vitals specialist
npm run test:pipeline  # full end-to-end pipeline (PSI → specialists → synth)
```

### Eval harness

```bash
npm run eval
# Runs the 7-URL golden set, 3 runs per URL, writes evals/results/<timestamp>.json
# Dashboard: http://localhost:3000/evals
```

The `/evals` page reads `evals/latest.json` and is itself cached with `cacheTag('eval-run')` — `revalidateTag('eval-run', 'max')` after a fresh run busts it on demand.

---

## Design decisions

The working log of why things are the way they are lives in [`docs/decisions.md`](docs/decisions.md). Highlights:

- **Haiku two-call pattern** — specialists emit findings in the tool-loop call, then a dedicated `generateText` call synthesizes a summary. Haiku's working memory couldn't reliably co-emit both; two Haiku calls still cost less than one Sonnet call.
- **Category-scoped lookup tools** — instead of one shared tool with prompt constraints, each specialist has its own tool with category hardcoded at construction. Prompt constraints are advisory; code constraints are enforced.
- **`relatedFindings` post-parse coercion** — after the eval harness exposed a 48% systematic schema-validation failure on Sonnet emitting `{id: "X"}` instead of `{id: ["X"]}`, the schema was loosened at the model-output boundary and canonicalized in code. This is load-bearing infrastructure, not defensive code — the coerce fires on ~1 in 3 runs.
- **Independent per-phase timeouts** — cumulative budgets silently rob downstream phases when one overruns; independent caps fail fast and readable.

The full canonical doc is [`docs/architecture.md`](docs/architecture.md). It's the source of truth for design choices — the project's agent rules (`CLAUDE.md`) require re-reading the relevant section before making architectural changes.

---

## What I'd build with more time

- **Persistence.** A lightweight Postgres table keyed on URL hash + PSI run ID would give customers "this is what changed since last week," which is where the product stops being a one-shot tool and starts being a monitoring surface.
- **Scheduled runs.** Weekly cron against a customer's top N pages, diffed against the previous run, alerts on regression via Slack. This is the natural bridge from "demo tool" to "team tool."
- **Per-customer feature weighting.** A Shopify store and a docs site have different perf budgets. Let the customer declare what they care about (LCP over INP, first-visit over repeat) and bias the synthesizer's `impact × ease` accordingly.
- **Eval harness as a first-class surface.** Today the eval dashboard is the product's own regression tool; the same shape could let a customer compare their pre/post-change scores directly.
- **Finding-level actions.** Many findings have a one-click fix (add a `priority` prop, wrap in `next/script`). Generate the PR diff inline, with a GitHub App installation.
- **Edge-runtime mode for the landing page.** `cacheComponents` doesn't support Edge yet, but the landing shell is trivially Edge-compatible. When the Next.js / Cache Components combo lands on Edge, move it.
- **Real-user data.** Add a CrUX lookup alongside PSI lab data so we're reporting on real users, not a single synthetic run. Lab data is what we can promise; field data is what the customer actually cares about.

---

## Project map

```
app/
  page.tsx              # Landing — PPR, static shell + client analyzer island
  analyze/page.tsx      # Analysis UI with streaming
  evals/page.tsx        # Eval dashboard — 'use cache' + cacheTag('eval-run')
  api/analyze/route.ts  # Streaming agent orchestration
lib/
  vercel-features.ts    # THE CATALOG. Recommendations must resolve here.
  psi.ts                # PageSpeed Insights wrapper
  html.ts               # Raw HTML + headers, graceful WAF handling
  data-slice.ts         # Per-specialist slice of combined PSI + HTML
  agents/
    image.ts            # Image specialist ToolLoopAgent
    bundle.ts           # JS bundle specialist
    cache.ts            # Cache/delivery specialist
    cwv.ts              # Core Web Vitals specialist
  synth.ts              # generateObject synthesizer
  pipeline.ts           # Phase orchestration + timeouts + degraded-lane handling
  schemas.ts            # Zod everywhere
scripts/
  eval.ts               # 7-URL golden-set harness
  test-*-specialist.ts  # Per-specialist harnesses
evals/
  golden/               # Hand-labeled URLs
  results/              # Run outputs
  latest.json           # Pointer to latest run
docs/
  architecture.md       # Canonical design doc
  decisions.md          # Working log of non-obvious choices
```
