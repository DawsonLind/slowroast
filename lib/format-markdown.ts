import type { Finding } from "@/lib/schemas";
import {
  getVercelFeatureById,
  type VercelFeatureId,
} from "@/lib/vercel-features";

// Severity → emoji. Keeps the markdown self-explanatory in plain-text contexts
// (Slack threads, ticket descriptions) where the receiver may not know our
// severity vocabulary at a glance.
const SEVERITY_EMOJI: Record<Finding["severity"], string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  opportunity: "🔵",
};

// Renders a Finding as Markdown for paste into Slack, Notion, GitHub, Linear,
// Jira, etc. Layout is intentionally stable — fixed section order, predictable
// heading levels — so the receiver's renderer produces consistent output.
//
// Affected resources are capped at five (the same cap the UI uses); a trailing
// "_+N more_" line preserves the count without creating a URL wall.
export function formatFindingAsMarkdown(finding: Finding): string {
  const feature = getVercelFeatureById(
    finding.vercelFeatureId as VercelFeatureId,
  );

  const lines: string[] = [
    `## ${SEVERITY_EMOJI[finding.severity]} ${finding.title}`,
    "",
    `**Severity:** ${finding.severity.toUpperCase()}  `,
    `**Confidence:** ${Math.round(finding.confidence * 100)}%`,
    "",
    "### Evidence",
    finding.evidence,
    "",
    "### Estimated impact",
    finding.estimatedImpact,
  ];

  if (finding.affectedResources.length > 0) {
    lines.push("", "### Affected resources");
    for (const r of finding.affectedResources.slice(0, 5)) {
      lines.push(`- \`${r}\``);
    }
    if (finding.affectedResources.length > 5) {
      lines.push(`- _+${finding.affectedResources.length - 5} more_`);
    }
  }

  if (feature) {
    lines.push(
      "",
      "### Recommended Vercel feature",
      `**${feature.title}** — effort: ${feature.effort}`,
      "",
      `- [Vercel docs](${feature.vercelDocs})`,
      `- [Next.js docs](${feature.nextDocs})`,
    );
  }

  return lines.join("\n");
}
