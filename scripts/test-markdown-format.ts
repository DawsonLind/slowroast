/**
 * Test script to demonstrate the markdown formatting for findings.
 * Shows example output that users will get when they copy a finding.
 */

import type { Finding } from "@/lib/schemas";
import { formatFindingAsMarkdown } from "@/lib/format-markdown";

const exampleFinding: Finding = {
  id: "lcp-image-missing-priority",
  title: "LCP image lacks priority attribute",
  severity: "critical",
  confidence: 0.95,
  category: "image",
  affectedResources: [
    "https://example.com/hero-image.jpg",
    "https://example.com/images/banner.png",
  ],
  estimatedImpact: "~800ms LCP improvement",
  vercelFeatureId: "next-image-priority",
  evidence:
    "The Largest Contentful Paint element is an <img> without the priority attribute. This forces the browser to discover it late in the parsing phase, delaying render.",
};

console.log("=== Example Markdown Output ===\n");
console.log(formatFindingAsMarkdown(exampleFinding));
console.log("\n=== End of Output ===\n");

console.log("This markdown can be pasted directly into:");
console.log("  • Slack (renders with formatting)");
console.log("  • Notion (converts to blocks automatically)");
console.log("  • GitHub/Linear issues (renders with syntax highlighting)");
console.log("  • Jira (as description or comment)");
