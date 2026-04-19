import { tool } from "ai";
import { z } from "zod";
import { lookupVercelFeature as catalogLookup } from "@/lib/vercel-features";
import { FindingCategorySchema } from "@/lib/schemas";

// Wraps the deterministic catalog lookup in lib/vercel-features.ts as an
// AI-SDK tool. Shared across all specialists: the catalog is static, so this
// tool is a module-level singleton. Per-run tools (like get_image_context)
// live inside each specialist's factory function, since they close over the
// slice for that URL.
//
// The description is load-bearing: it's the contract the model reads. The
// "YOU MUST NOT recommend a feature you did not receive from this tool"
// language is what enforces the no-hallucinated-features guarantee at
// prompt time; Zod validation on the synthesizer output is what enforces it
// at runtime.
export const lookupVercelFeatureTool = tool({
  description:
    "Look up a Vercel feature by a free-text concern (e.g. 'hero image missing priority', 'unoptimized image formats'). Optionally filter by category. Returns the best catalog match or { found: false } if nothing is confident. YOU MUST NOT recommend a Vercel feature you did not receive from this tool.",
  inputSchema: z.object({
    concern: z
      .string()
      .min(1)
      .describe(
        "Free-text description of the performance concern, in the words of the finding you intend to produce",
      ),
    category: FindingCategorySchema.optional().describe(
      "Optional filter: image, bundle, cache, or cwv. Use to narrow when the concern could match multiple categories.",
    ),
  }),
  execute: async (input) => catalogLookup(input),
});
