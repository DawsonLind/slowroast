"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center text-foreground">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error reached the page boundary. The analyzer itself has
        its own error panel - this fires only if a render threw.
      </p>
      {error.digest ? (
        <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          digest: {error.digest}
        </code>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
