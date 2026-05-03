import type { Finding } from "@/lib/schemas";
import { getVercelFeatureById, type VercelFeatureId } from "@/lib/vercel-features";

/**
 * Formats a finding as markdown for copy-paste into Slack, Notion, tickets.
 * Structure: severity badge + title + evidence + impact + Vercel feature link.
 */
export function formatFindingAsMarkdown(finding: Finding): string {
  const feature = getVercelFeatureById(finding.vercelFeatureId as VercelFeatureId);
  
  const severityEmoji = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    opportunity: "🔵",
  }[finding.severity];

  const severityLabel = finding.severity.toUpperCase();

  const lines: string[] = [
    `## ${severityEmoji} ${finding.title}`,
    "",
    `**Severity:** ${severityLabel}`,
    `**Confidence:** ${Math.round(finding.confidence * 100)}%`,
    "",
    `### Evidence`,
    finding.evidence,
    "",
    `### Estimated Impact`,
    finding.estimatedImpact,
  ];

  if (finding.affectedResources.length > 0) {
    lines.push("", "### Affected Resources");
    finding.affectedResources.slice(0, 5).forEach((resource) => {
      lines.push(`- \`${resource}\``);
    });
    if (finding.affectedResources.length > 5) {
      lines.push(`- *+ ${finding.affectedResources.length - 5} more*`);
    }
  }

  if (feature) {
    lines.push(
      "",
      "### Recommended Vercel Feature",
      `**${feature.title}**`,
      "",
      `- [Vercel docs](${feature.vercelDocs})`,
      `- [Next.js docs](${feature.nextDocs})`,
      "",
      `**Effort:** ${feature.effort}`,
    );
  }

  return lines.join("\n");
}
