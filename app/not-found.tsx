import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center text-foreground">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        404 — not found
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Slowroast only exposes two routes:{" "}
        <code className="font-mono">/</code> for the analyzer and{" "}
        <code className="font-mono">/evals</code> for the dashboard.
      </p>
      <div className="flex gap-2">
        <Link href="/" className={cn(buttonVariants())}>
          Analyzer
        </Link>
        <Link href="/evals" className={cn(buttonVariants({ variant: "outline" }))}>
          Evals
        </Link>
      </div>
    </div>
  );
}
