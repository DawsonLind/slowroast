---
name: create-specialist-agent
description: "Scaffold a new specialist ToolLoopAgent following the established project pattern. Use when adding image/bundle/cache/cwv or a future new specialist. Enforces the shared structure so all specialists stay consistent."
user-invocable: true
argument-hint: "<specialist-name>"
---

# Create Specialist Agent

You are creating a new specialist `ToolLoopAgent` in `lib/agents/$1.ts`. This project has four specialists and they must share structure. Deviating makes the synthesizer's job harder and the eval harness less meaningful.

## Context to load first

1. Read `@docs/architecture.md` §4 (Agent Roster & Tools) — the canonical spec for specialists.
2. Read `lib/schemas.ts` to understand the `Finding` and specialist output types.
3. Read `lib/agents/shared-tools.ts` to see `lookup_vercel_feature`.
4. If another specialist already exists, read it as the reference pattern. Match its shape.

## File to create

`lib/agents/$1.ts`

## Structure (do not deviate)

```ts
import { ToolLoopAgent, tool, stepCountIs, Output } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { lookupVercelFeatureTool } from "./shared-tools";
import { SpecialistOutputSchema, type SpecialistOutput } from "@/lib/schemas";
import type { XSlice } from "@/lib/data-slice";  // per-specialist slice type

const INSTRUCTIONS = `You analyze [domain] performance...`;  // ~30-50 lines

// Per-call factory: tools that need to close over this URL's data must be
// constructed inside runXSpecialist, not at module scope. The shared catalog
// lookup stays a singleton because the catalog is static.
export async function runXSpecialist(slice: XSlice): Promise<SpecialistOutput> {
  const getXContext = tool({
    description: "...",
    inputSchema: z.object({ /* ... */ }),
    execute: async (input) => { /* closes over `slice` */ },
  });

  const agent = new ToolLoopAgent({
    model: gateway("anthropic/claude-haiku-4.5"),  // Haiku for specialists — cost/latency
    instructions: INSTRUCTIONS,                    // AI SDK 6 field name (NOT `system`)
    tools: {
      get_x_context: getXContext,
      lookup_vercel_feature: lookupVercelFeatureTool,
    },
    stopWhen: stepCountIs(6),                      // bounded loop
    output: Output.object({ schema: SpecialistOutputSchema }),  // typed, Zod-validated
    providerOptions: {
      gateway: { order: ["anthropic", "openai"] },
    },
  });

  const result = await agent.generate({ prompt: buildPrompt(slice) });
  return result.output;  // already typed + validated via Output.object
}

function buildPrompt(slice: XSlice): string { /* structured summary of the slice */ }
```

## Checklist before you're done

- [ ] Instructions have three sections: role, process, constraints (see architecture doc §12 for the image specialist's prompt as reference).
- [ ] Every tool has a Zod `inputSchema` with descriptions (the model reads these).
- [ ] `stopWhen` is bounded (default `stepCountIs(6)`).
- [ ] Model string uses Gateway format: `anthropic/claude-haiku-4.5`.
- [ ] Output uses `Output.object({ schema: SpecialistOutputSchema })` so `result.output` is Zod-validated.
- [ ] Every finding the specialist produces has a `vercelFeatureId` that will resolve via `lookupVercelFeatureTool`.
- [ ] The specialist is wired into `app/api/analyze/route.ts` via `Promise.all`.
- [ ] A new test entry is added to `evals/golden/*.json` covering this specialist's domain (if not already covered).

## What NOT to do

- Do not use `generateText` directly — use `ToolLoopAgent`.
- Do not give the specialist access to tools outside its domain.
- Do not use Sonnet — specialists are Haiku. Synth is Sonnet.
- Do not add state or side effects outside the returned output.
- Do not call PSI or fetch HTML from within the specialist — that's the route handler's job. Specialists receive pre-fetched data.
