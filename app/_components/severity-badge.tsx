import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/schemas";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-sev-critical/15 text-sev-critical ring-1 ring-sev-critical/30",
  high: "bg-sev-high/15 text-sev-high ring-1 ring-sev-high/30",
  medium: "bg-sev-medium/15 text-sev-medium ring-1 ring-sev-medium/30",
  opportunity:
    "bg-sev-opportunity/15 text-sev-opportunity ring-1 ring-sev-opportunity/30",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        SEVERITY_STYLES[severity],
      )}
    >
      {severity}
    </span>
  );
}
