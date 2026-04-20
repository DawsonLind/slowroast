import { cn } from "@/lib/utils";

// Small coffee-bean silhouette — the only visual nod to the "slowroast"
// metaphor. Kept restrained: one shape, amber stroke, ~18px. The curve
// is the signature center crease of a bean, not a full illustration.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("h-[18px] w-[18px] text-primary", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4.5c3-1.5 9-1.5 12 0 2 1 3 3.5 3 7.5s-1 6.5-3 7.5c-3 1.5-9 1.5-12 0-2-1-3-3.5-3-7.5s1-6.5 3-7.5Z" />
      <path d="M7.5 6c1.5 2.5 1.5 9.5 0 12" />
      <path d="M16.5 6c-1.5 2.5-1.5 9.5 0 12" />
    </svg>
  );
}
