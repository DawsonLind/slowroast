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
import { ToolLoopAgent, tool, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { lookupVercelFeature } from "./shared-tools";
import type { SpecialistInput, SpecialistOutput } from "@/lib/schemas";

const SYSTEM_PROMPT = `You analyze [domain] performance...`;  // ~30-50 lines

// Domain-specific tools. 1-2 max. Always include lookup_vercel_feature.
const getXContext = tool({
  description: "...",
  inputSchema: z.object({ /* ... */ }),
  execute: async (input) => { /* ... */ },
});

export const $1Agent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),  // Haiku for specialists — cost/latency
  system: SYSTEM_PROMPT,
  tools: {
    get_x_context: getXContext,
    lookup_vercel_feature: lookupVercelFeature,
  },
  stopWhen: stepCountIs(6),  // bounded loop
  providerOptions: {
    gateway: { order: ["anthropic", "openai"] },  // fallback
  },
});

export async function run$1Specialist(input: SpecialistInput): Promise<SpecialistOutput> {
  const result = await $1Agent.generate({ prompt: buildPrompt(input) });
  return parseSpecialistOutput(result);  // validate against schema
}

function buildPrompt(input: SpecialistInput): string { /* ... */ }
function parseSpecialistOutput(result: unknown): SpecialistOutput { /* ... */ }
```

## Checklist before you're done

- [ ] System prompt has three sections: role, process, constraints (see architecture doc §12 for the image specialist's prompt as reference).
- [ ] Every tool has a Zod `inputSchema` with descriptions (the model reads these).
- [ ] `stopWhen` is bounded (default `stepCountIs(6)`).
- [ ] Model string uses Gateway format: `anthropic/claude-haiku-4.5`.
- [ ] Output is parsed and validated against the specialist output schema in `lib/schemas.ts`.
- [ ] Every finding the specialist produces has a `vercelFeatureId` that will resolve via `lookupVercelFeature`.
- [ ] The specialist is wired into `app/api/analyze/route.ts` via `Promise.all`.
- [ ] A new test entry is added to `evals/golden/*.json` covering this specialist's domain (if not already covered).

## What NOT to do

- Do not use `generateText` directly — use `ToolLoopAgent`.
- Do not give the specialist access to tools outside its domain.
- Do not use Sonnet — specialists are Haiku. Synth is Sonnet.
- Do not add state or side effects outside the returned output.
- Do not call PSI or fetch HTML from within the specialist — that's the route handler's job. Specialists receive pre-fetched data.
