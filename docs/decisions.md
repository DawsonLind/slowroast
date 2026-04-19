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
Context: During image specialist testing, findings consistently resolved to
features outside the image category (e.g., SVG sizing → next-image-priority).
Options considered:
- Keep shared tool, rely on prompt constraints to keep model in-category
- Keep shared tool, add category filter post-hoc
- Inline per-specialist tools with category hardcoded at construction
Chose: Inline per-specialist tools.
Why: Removes an entire class of model-behavior bugs by making the wrong
choice physically impossible. The category is deterministic per specialist
— there's no reason to let the model vary it. Prompt constraints are advisory;
code constraints are enforced.
Tradeoffs: Slight code duplication across specialists. Mitigated by either
converting shared-tools.ts into a factory on Chunk 2, or accepting 4 similar
inline definitions.

## End of Day 2 Chunk 1 — 4/18/26 8:46 PM

State: Image specialist working end-to-end. Two-call pattern (findings + summary)
on Haiku, catalog-scoped lookup tool, SVG false-positive fix, graceful summary
fallback, prompt constraints aligned between PROCESS and CONSTRAINTS.

Known edge cases:
- Nondeterminism on borderline findings (expected LLM variance)
- Eval-time verification of feature-concern semantic match deferred to Day 3

Next: Chunk 2 — bundle, cache, CWV specialists following image.ts as reference.

## Decision: Carry Chunk 1's two-call pattern into bundle/cache/cwv from the start
Date: 4/18/26
Context: Chunk 1 discovered the two-call pattern (findings in a tool-loop call + summary in a dedicated generateText call) because Haiku's working memory couldn't reliably co-emit both. Chunk 2 built three more specialists; we had a choice to either re-derive the pattern from scratch or clone the proven shape.
Options considered:
- Treat each specialist as a clean slate and see if Haiku behaves differently in the bundle/cache/cwv domains
- Clone the image specialist's structural shape (narrow model output schema, separate summary call, try/catch fallback) from the start
Chose: Clone the proven shape. Every new specialist has the same file structure: narrow ModelOutputSchema with just findings, dedicated generateSummary helper, degraded-summary fallback in the run{X}Specialist wrapper, instructions split into ROLE/PROCESS/CONSTRAINTS.
Why: The working-memory issue is a property of the model (Haiku), not the domain. Re-discovering it per specialist would burn eval cycles and leave the codebase inconsistent. Uniformity also makes the future refactor target obvious if we ever want to abstract a shared runSpecialist factory.
Tradeoffs: Four near-identical file skeletons. Accepted for now — Rule of Three hasn't bitten hard enough to justify an abstraction, and the per-specialist prompts + tools differ enough that premature extraction would hide the interesting parts.

## Decision: CWV specialist as a scope-boundary enforcer, not a catch-all
Date: 4/18/26
Context: The CWV catalog has only two features (font-optimization, partial-prerendering), but Core Web Vitals signal is the broadest of all four domains — nearly every perf issue shows up as an LCP/CLS/INP/TBT regression somewhere. Without guardrails the CWV specialist would be tempted to attribute image-byte-driven LCP to an image feature, or JS-heavy INP to a bundle feature, producing cross-category findings that violate the one-specialist-per-category assumption the synthesizer depends on.
Options considered:
- Allow CWV to reach into other categories' catalog subsets when the root cause points there
- Restrict CWV to its two catalog features; when the root cause lives elsewhere, describe it in the prose summary and let the responsible specialist pick it up
- Expand the CWV catalog subset to include image/bundle/cache features for "CWV-relevant" cases
Chose: Restrict CWV to its two features. The scope boundary is stated explicitly in the specialist's CONSTRAINTS and enforced structurally by the CWV-pinned lookup tool (category hardcoded to "cwv"). When the CWV specialist sees image-driven LCP or JS-driven INP, it emits zero findings and names the responsible lane in its summary. A sparse findings array is the CORRECT shape, not a gap.
Why: Sonnet synthesis is far better at merging evidence across specialists than it is at resolving cross-category findings from a single specialist. The scope boundary also keeps each specialist's reasoning locally coherent — the CWV prompt is ~25% the cognitive load of a version that had to reason about which specialist owns which fix.
Tradeoffs: CWV often produces zero findings — counterintuitive for a specialist. Addressed by a prominent SCOPE BOUNDARY constraint in the prompt AND by a scope-boundary check in the test harness that flags any finding that escapes the CWV subset.

## Decision: Extract summarizeAuditDetails to lib/audit-summary.ts at Rule of Three
Date: 4/18/26
Context: image.ts originally inlined a summarizeDetails helper that projected Lighthouse audit details (overallSavingsMs, overallSavingsBytes, type, items-sliced-to-5) into a char-capped JSON string. When building cache.ts and cwv.ts, both needed the same projection shape — cache for header-dense audits, cwv for multi-audit diagnostic returns.
Options considered:
- Leave the helper inline in image.ts and copy it into cache.ts and cwv.ts
- Extract to a shared lib/audit-summary.ts with an opts object for itemCap/charCap
- Build a richer "audit projection" module that tries to handle all Lighthouse detail variants
Chose: Extract to lib/audit-summary.ts during the cache specialist build, refactor image.ts to consume it in the same step, and use it from cwv.ts's diagnostic tool (with a tighter 1200-char cap for multi-audit returns).
Why: Rule of Three — the second caller proved the projection shape was stable; the third caller made extraction pay for itself in reduced drift. Option shape (itemCap/charCap) keeps the helper honest about its tunables without over-generalizing.
Tradeoffs: Two new files to maintain (lib/audit-summary.ts + its usage sites), but each specialist's file is smaller and behaviorally identical. Image-specialist behavior parity was verified by re-running test:image post-refactor.

## Decision: Partial specialist failures become summary-prefix markers, not schema errors
Date: 4/18/26
Context: Chunk 3's pipeline needs to survive a specialist crashing (model gateway rate-limit, schema validation miss, timeout) without dropping the whole report. The question was how to represent a degraded lane in the data that flows to the synthesizer.
Options considered:
- Extend SpecialistOutputSchema with an optional `error?: string` field; every consumer learns the new field.
- Filter failed specialists out of the synth input entirely; synth never knows there were four and can't name the skipped lane in executiveSummary.
- Return a placeholder SpecialistOutput whose `summary` starts with "[specialist-failed] ..." and `findings: []`; the synth prompt keys off the prefix and excludes the lane while still able to mention it.
Chose: The summary-prefix marker. Pipeline wraps each specialist call in wrapSpecialist() which catches all errors and returns the placeholder. The route response ALSO carries a sibling `degradedSpecialists: FindingCategory[]` (stamped in code, not model-emitted) so the UI can show a banner without parsing prose.
Why: Keeps SpecialistOutputSchema pure — the existing four specialist files and their tests don't change. The marker shape reuses the exact same pattern image.ts already uses for degraded-summary fallback, so there's one conceptual idiom for "lane succeeded but with reduced output." Filtering was rejected because executiveSummary losing the ability to name the skipped lane degrades the user-facing narrative.
Tradeoffs: The prefix is a string convention rather than a type-system boundary — drift between the producer (wrapSpecialist) and the consumer (synth prompt) is possible. Mitigated by a single FAILURE_PREFIX constant in pipeline.ts and an explicit rule in the synth INSTRUCTIONS.

## Decision: ReportSchema.topPriority is optional
Date: 4/18/26
Context: A well-configured site can legitimately produce zero findings across all four specialists. The original ReportSchema required topPriority, which would force generateObject to fabricate one — exactly the hallucination we're trying to prevent.
Options considered:
- Keep topPriority required; when findings[] is empty, invent a synthetic "no issues found" finding.
- Make topPriority optional; emit it only when findings[] is non-empty.
- Short-circuit around the synth when all specialists return zero findings, skip generateObject entirely.
Chose: Make topPriority optional. The synth prompt explicitly instructs "If findings[] is empty, omit topPriority — do not fabricate one." The downstream UI renders a "no issues found" branch.
Why: A zero-findings report is a real, valid product state (the eval golden set even includes a case for it). Forcing a synthetic topPriority would violate the "facts from data, judgment from LLM, no inventions" architecture principle from §2. Short-circuiting the synth is an optimization we can add later — the prose summary from Sonnet is still valuable even with zero findings.
Tradeoffs: Consumers of ReportSchema.topPriority need to handle the optional case. Acceptable — it's the right shape.

## Decision: Synthesizer is generateObject only; streamText deferred to Day 3
Date: 4/18/26
Context: docs/architecture.md §4 originally described the synthesizer as "generateObject PLUS streamText for executive summary." Chunk 3 has no client UI yet — nothing is listening to a stream — and the ReportSchema already carries executiveSummary inside the structured object.
Options considered:
- Run both calls now: generateObject for structure + streamText for prose. Scaffold streaming infra for Day 3.
- Run only generateObject; executiveSummary lives inside the report for v1; add streamText on Day 3 when the UI lands and the UX decision (parallel stream vs structured-only) can be made with real screens.
- Skip generateObject entirely; synth in a tool-loop agent. Rejected — the synth has no tools, all facts are in the prompt.
Chose: generateObject only for Chunk 3. executiveSummary is a field in the structured output. Day 3 will decide whether to move it out into a parallel streamText call based on how the UI wants to render it.
Why: streamText with no client consumer is wasted machinery — either a third round-trip against already-synthesized data, or duplicate tokens. The architecture doc's "generateObject + streamText" wording is a design intent; the actual streamText call is a Day 3 concern when tokens-per-second matters. Writing it now would either be deleted or refactored on Day 3.
Tradeoffs: executiveSummary lands all-at-once (non-streaming) for now. Fine for Chunk 3's API-only surface; the UI work will redesign the streaming topology anyway.

## Decision: Independent per-phase timeout budgets with the 40s/15s pair
Date: 4/18/26
Context: Chunk 3 needs to guarantee the ~90s pitch under worst-case behavior. PSI self-caps at 30s; specialists and synth needed caps. The question was whether to use cumulative or independent budgets.
Options considered:
- Cumulative: total 90s wall clock, phases share leftover time (slow PSI eats specialist budget).
- Independent: each phase has its own hard cap, summing to ≤ 90s total. Failure surfaces immediately when a phase overruns.
Chose: Independent phase caps. PSI=30s (existing), specialists=40s (Promise.race per-specialist), synth=15s (AbortSignal via AbortSignal.any composing caller + timer). Total 85s + 5s slack under the route's maxDuration=90s.
Why: Matches the user-stated "fail-fast UX" requirement. A slow PSI does not silently rob specialists of their budget and cause a less-obvious downstream failure — it causes a clean 502 with `PsiError.kind: "timeout"` in the response body. Independent budgets also keep the failure taxonomy readable when debugging a timed-out run.
Tradeoffs: The worst-case wall clock is the SUM of the caps (85s), not the max. If PSI takes its full 30s, we still have 40+15s for downstream — we don't claw back the difference for a faster overall response. Accepted for Chunk 3; could revisit if we observe PSI consistently completing well under 30s and specialists need more headroom.

## End of Day 2 Chunk 3 — 4/18/26
State: Synthesizer + pipeline + route handler + test harness in place. Typecheck clean.
Verification state: Structural error paths validated end-to-end — gateway rate-limit on the free tier during test:pipeline exercised degraded-specialist placeholders, degraded-summary fallbacks in image.ts/bundle.ts, and PipelineError(kind: "synth") clean propagation. Happy-path end-to-end output not yet verified — requires the Vercel AI Gateway rate limit to lift or paid credits. Revisit when credits top up.
Next: Day 3 — eval harness (scripts/eval.ts), /evals page ('use cache' + cacheTag('eval-run')), streaming + UI in /analyze.
## Decision: Eval harness uses 60s synth timeout; API route stays at 30s
Date: 4/19/26
Context: Day 3 priority 1 eval harness ran initially with synthTimeoutMs=30000 (matching the API route). First URL of the golden set (hulu.com) failed 3/3 with synth timeouts at 30s; reddit.com failed on run 0 with either a timeout or schema-validation mismatch. Meanwhile Day 2's vercel.com baseline had synth p50=26s with 1/3 at the 30s cap. The pattern: large, findings-rich pages blow past 30s consistently because ReportSchema structured output scales with the number of findings × catalog-enum validation the model has to satisfy per call.
Options considered:
- Hold 30s for both eval and API route. Accept that half the golden set shows synth-timeout failures in the dashboard.
- Raise only the eval harness synth timeout to 60s, matching the PSI eval-tier carve-out pattern (API route 30s, harness 60s).
- Raise both synth timeouts globally.
Chose: Eval harness at 60s, API route stays at 30s. scripts/eval.ts passes synthTimeoutMs=60_000 explicitly; pipeline DEFAULT_SYNTH_TIMEOUT_MS remains 30_000.
Why: Different consumers have different latency budgets. The API route owes a user a fast failure so they can retry — 30s is aggressive-but-honest. The eval harness exists to measure output quality on real sites; a 30s ceiling means "test runs fail before they produce any signal" which defeats the point. This mirrors psiTimeoutMs=60000 passed by the harness vs 30s default for the route (see the 4/18 phase-budget decision and RunAnalysisOptions.psiTimeoutMs inline rationale).
Tradeoffs: Eval-tier measurements are not directly comparable to API-route p95s — the harness observes a more permissive ceiling. Accepted: the eval-tier timings inform product decisions (can we live with Sonnet's variance?) rather than SLO reporting. If we later decide the route itself needs >30s, that's a separate decision driven by observed user-facing failure rates.
