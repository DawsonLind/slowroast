## Decision: haiku > sonnet for image auditing
Date: 4/18/26
Context: haiku couldnt generate a summary of its image findings in a single prompt due to working memory constraints
Options considered: 
    - upgrade to sonnet for more context
    - return a simple hard-coded summary if haiku fails to generate summary
    - removed summary generation from first haiku call and create a second call dedicated to generating a summary
Chose: initially i tested upgrading the model to sonnet, but saw sonnet struggle too. i then decided that a second haiku call would be more reliable and 2 haiku calls still costs less than one sonnet call
Why: i didn't want to waste the findings of the initial haiku call and i wanted to maintain haiku for web scraping - sonnect for synthizing results
Tradeoffs: with the second haiku call approach, there is a chance that the inital call fails then the second call is simply wasted tokens.this is necessary waste as it is the only way to keep the catagories consistent for the sonnet synthizing step.

## Decision: Specialist-scoped lookup tools vs shared tool
Context: image specialist kept resolving findings to features outside its category, e.g. an svg sizing issue mapping to next-image-priority
Options considered:
- keep the shared tool and rely on the prompt to keep it in-category
- keep shared, add a post-hoc filter
- inline per-specialist tool with the category hardcoded
Chose: per-specialist tools, category hardcoded at construction
Why: the category is deterministic per lane, no point letting the model pick it. prompts are a suggestion, code isnt.
Tradeoffs: some duplication across the four files. can factor into a factory later if it starts to hurt

## End of Day 2 Chunk 1 — 4/18/26 8:46 PM

State: image specialist working end to end. two haiku calls (findings + summary), catalog-scoped lookup tool, svg false-positive fixed, prompt constraints lined up between PROCESS and CONSTRAINTS.

Known edge cases:
- nondeterminism on borderline findings (expected llm variance)
- semantic feature-concern match check deferred to day 3 eval

Next: chunk 2 - bundle cache cwv specialists using image.ts as the reference.

## Decision: Carry Chunk 1's two-call pattern into bundle/cache/cwv from the start
Date: 4/18/26
Context: chunk 1 landed on the two-call pattern (tool-loop findings + dedicated summary call) because haiku's working memory couldnt do both together. question for chunk 2 was whether to rediscover it per specialist or just clone
Options considered:
- treat each specialist as a clean slate
- clone image.ts shape from the start
Chose: clone. every new specialist ends up with the same skeleton - narrow ModelOutputSchema for findings only, separate generateSummary helper, degraded fallback, prompt split into ROLE/PROCESS/CONSTRAINTS
Why: the memory thing is a model property not a domain one. no point finding it three more times
Tradeoffs: four near-identical file skeletons. rule of three hasnt really bitten yet, the per-specialist prompts + tools differ enough that extracting too early would hide the interesting parts

## Decision: CWV specialist as a scope-boundary enforcer, not a catch-all
Date: 4/18/26
Context: the cwv catalog only has two features (font-optimization, partial-prerendering) but cwv signal is the broadest of the four - LCP/CLS/INP show up as the symptom for image or bundle root causes all the time. without guardrails cwv would happily attribute image-byte-driven LCP to an image feature, which breaks the one-specialist-per-category assumption the synth leans on
Options considered:
- let cwv reach into other catalogs when the root cause points elsewhere
- restrict cwv to its two features, let the responsible specialist handle the rest
- expand the cwv catalog subset
Chose: restrict. scope boundary is stated in CONSTRAINTS and enforced by the lookup tool pinning category="cwv". when cwv sees image-driven LCP it returns zero findings and names the responsible lane in its summary. sparse findings is the correct shape not a gap
Why: sonnet is way better at merging across specialists than a single specialist is at resolving cross-category attribution. also keeps the cwv prompt way smaller
Tradeoffs: cwv often produces zero findings which is counterintuitive. theres a scope-boundary callout in the prompt and the test harness flags any escape

## Decision: Extract summarizeAuditDetails to lib/audit-summary.ts at Rule of Three
Date: 4/18/26
Context: image.ts had an inline helper that flattened lighthouse audit details (overallSavingsMs, overallSavingsBytes, type, items sliced) into a char-capped json string. cache and cwv both needed the same projection
Options considered:
- leave inline, copy into cache and cwv
- extract with itemCap/charCap opts
- build a richer projection module covering every lighthouse detail variant
Chose: extract to lib/audit-summary.ts during the cache build, refactor image.ts to use it at the same time. cwv uses it with a tighter 1200-char cap for its multi-audit diagnostic tool
Why: second caller proved the shape was stable, third made it pay off
Tradeoffs: one more file. image parity verified by re-running test:image after

## Decision: Partial specialist failures become summary-prefix markers, not schema errors
Date: 4/18/26
Context: the pipeline needs to survive one specialist crashing (gateway 429, schema miss, timeout) without dropping the whole report. question was how to encode the degraded lane in the data flowing to the synth
Options considered:
- add optional error field to SpecialistOutputSchema
- filter the failed lane out entirely (synth doesnt know it existed)
- placeholder output whose summary starts "[specialist-failed] ..." and findings is []
Chose: the prefix marker. wrapSpecialist() catches and returns the placeholder. the route also returns degradedSpecialists: FindingCategory[] alongside so the UI can render a banner without parsing prose
Why: keeps SpecialistOutputSchema unchanged - the four specialist files and their tests dont move. the prefix idiom is already what image.ts uses for its degraded-summary fallback, so one pattern not two. filtering was rejected because exec summary losing the ability to name the skipped lane is a real user-facing regression
Tradeoffs: its a string convention not a type boundary. one FAILURE_PREFIX constant + an explicit rule in the synth prompt keep producer and consumer in sync

## Decision: ReportSchema.topPriority is optional
Date: 4/18/26
Context: a well-built site can legitimately produce zero findings across all four specialists. original schema required topPriority, which would force generateObject to fabricate one
Options considered:
- keep required, invent a synthetic "no issues" finding when empty
- make optional, emit only when findings is non-empty
- short circuit around the synth entirely when everything returns zero
Chose: optional. synth prompt says "if findings is empty, omit topPriority - do not fabricate one." UI has a no-issues branch
Why: zero findings is a real valid product state (the golden set even has one). forcing a synthetic top priority is exactly the hallucination the whole design is built to avoid
Tradeoffs: consumers of topPriority have to handle the optional. fine - thats the right shape

## Decision: Synthesizer is generateObject only; streamText deferred to Day 3
Date: 4/18/26
Context: architecture doc §4 described the synth as "generateObject PLUS streamText for executive summary." chunk 3 has no UI yet so nothing would consume the stream
Options considered:
- run both now, scaffold streaming infra for day 3
- generateObject only, executiveSummary lives inside the structured object, decide about streamText on day 3
- skip generateObject, do the synth in a tool-loop agent (rejected, synth has no tools)
Chose: generateObject only. executiveSummary is a field in the structured output for now
Why: streamText with no client is either a wasted third round-trip or duplicate tokens. day 3 can decide when theres a real UI to design against
Tradeoffs: exec summary lands all at once, no streaming. fine for an api-only surface

## Decision: Independent per-phase timeout budgets with the 40s/15s pair
Date: 4/18/26
Context: chunk 3 has to hold the ~90s pitch under worst case. PSI self-caps at 30s. specialists and synth needed their own caps and the question was whether to give them independent budgets or a shared pool
Options considered:
- cumulative 90s pool, slow PSI eats into specialist budget
- independent per-phase caps summing to <= 90s total
Chose: independent. PSI=30s (existing), specialists=40s (Promise.race per lane), synth=15s (AbortSignal via AbortSignal.any composing caller + timer). 85s + 5s slack under the route's maxDuration=90s
Why: matches the fail-fast UX goal. a slow PSI gives you a clean PSI timeout error instead of silently stealing time from downstream phases and producing a harder-to-debug failure
Tradeoffs: worst-case wall clock is the sum not the max. if PSI takes all 30s we dont claw any of it back. fine for now, revisit once we see real p95s

## End of Day 2 Chunk 3 — 4/18/26
State: synth + pipeline + route handler + test harness all in, typecheck clean
Verification: structural error paths validated end-to-end - gateway rate-limiting on the free tier during test:pipeline exercised the degraded-specialist placeholders, the degraded-summary fallbacks in image.ts/bundle.ts, and PipelineError(kind: "synth") propagation. happy-path end-to-end not verified yet - waiting on the rate limit to lift or paid credits
Next: day 3 - eval harness (scripts/eval.ts), /evals page ('use cache' + cacheTag), streaming + UI on /analyze

## Decision: Eval harness uses 60s synth timeout; API route stays at 30s
Date: 4/19/26
Context: eval harness first ran with synthTimeoutMs=30000 matching the api route. hulu failed 3/3 on synth timeout at 30s, reddit failed one run. meanwhile vercel baseline had synth p50 ~26s. pattern is that findings-rich pages blow past 30s consistently - structured output scales with findings × catalog-enum validation per call
Options considered:
- hold 30s for both, live with the dashboard failures
- raise only the harness to 60s (same carveout pattern we use for PSI)
- raise both globally
Chose: harness at 60s, route stays 30s. scripts/eval.ts passes synthTimeoutMs=60_000 explicitly, DEFAULT_SYNTH_TIMEOUT_MS unchanged
Why: different consumers, different budgets. the route owes the user a fast failure. the harness is there to measure quality, so a ceiling that eats runs before they produce signal defeats the point. same shape as psiTimeoutMs=60000 in the harness
Tradeoffs: harness timings arent directly comparable to route p95s. fine - harness feeds product decisions not SLOs

## Decision: Coerce relatedFindings string-values to arrays at synth boundary
Date: 4/19/26

Context: first full eval run was 43% success (9/21). 10 of 12 failures were sonnet emitting "No object generated: response did not match schema" on the synth generateObject call. first response was a retry-with-backoff loop (3 attempts, 500ms linear) which lifted success to 52% then plateaued. the retry infra incidentally captured synthAttempts with zodIssues + raw model output per attempt, which is what made diagnosis possible

captured failures all had the same zodIssue shape. path: ["relatedFindings", <finding-id>]. message: "Invalid input: expected array, received string." sonnet was emitting relatedFindings as {"X": "Y"} instead of {"X": ["Y"]}. three retries on the same inputs = same error, not sampling variance. a systematic mismatch between how sonnet resolves the one-to-one case (scalar feels natural) and how the schema encoded it (always array)

the URLs that failed systematically (mozilla 0/3, ticketmaster 0/3, gov.uk 1/3) were exactly the ones whose findings cross-referenced each other. URLs without cross refs (github, vercel) succeeded every time

Options considered:
- prompt tightening: tell the model "always arrays, even single" with an example. cheapest but three retries saying the same thing is strong evidence the pull is structural
- schema loosening with post-parse coercion: accept z.union([z.array(z.string()), z.string()]) at the model boundary, coerce bare strings to one-element arrays before downstream. lossless, a bare string means the same thing as a single-element array
- belt and suspenders: both

Chose: schema loosen + coerce at the model-output boundary only. strict catalog validation at FindingWithValidatedFeatureSchema stays untouched. kept the retry loop because its separately useful for gateway flakes (hulu recovered on retry 2 during the earlier run, different failure class)

Why: same pattern we already use elsewhere - narrow model-output schemas, stamp canonical shape in code. the specialist schemas already do this. option B assumes you can talk sonnet out of its natural interpretation and the evidence said you cant

Validated: post-fix run went to 19/21 (90.5%), zero schema-validation failures. coercion fires ~6 times across 21 runs so its load-bearing not defensive

Tradeoffs: the union means the model layer tolerates a second shape. coerce runs immediately after generateObject so the loose shape never leaks downstream. test coverage on the coerce matters - a regression would silently drop cross-reference data
