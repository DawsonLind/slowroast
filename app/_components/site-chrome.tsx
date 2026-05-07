import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function SiteHeader({
  subtitle,
  maxWidthClass = "max-w-5xl",
}: {
  subtitle: string;
  maxWidthClass?: "max-w-5xl" | "max-w-6xl";
}) {
  return (
    <header className="border-b border-border">
      <div
        className={cn(
          "mx-auto flex w-full items-center justify-between gap-4 px-6 py-4",
          maxWidthClass,
        )}
      >
        <Link
          href="/"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandMark />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Slowroast
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {subtitle}
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-3 text-sm sm:gap-4">
          <Link
            href="/"
            className="rounded-sm px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Analyze
          </Link>
          <Link
            href="/evals"
            className="rounded-sm px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Evals
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({
  maxWidthClass = "max-w-5xl",
}: {
  maxWidthClass?: "max-w-5xl" | "max-w-6xl";
}) {
  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          "mx-auto flex w-full items-center justify-center px-6 py-4 text-xs text-muted-foreground",
          maxWidthClass,
        )}
      >
        <span>Next.js 16 · AI SDK 6 · Fluid Compute</span>
      </div>
    </footer>
  );
}
