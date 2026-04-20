"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLE_URL = "https://vercel.com";

export function UrlForm({
  url,
  onUrlChange,
  onSubmit,
  onReset,
  canReset,
  isLoading,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onReset: () => void;
  canReset: boolean;
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <label className="sr-only" htmlFor="url">
          URL to analyze
        </label>
        <Input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={isLoading}
          className="h-12 font-mono text-base sm:flex-1"
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="lg"
            disabled={isLoading || url.trim() === ""}
            className="group h-12 px-6 transition-all hover:shadow-[0_0_24px_-4px_var(--color-primary)]"
          >
            <span className="font-medium">
              {isLoading ? "Analyzing…" : "Analyze"}
            </span>
            {!isLoading && (
              <span
                aria-hidden
                className="ml-2 inline-block transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            )}
          </Button>
          {canReset ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onReset}
              className="h-12 px-4"
            >
              New URL
            </Button>
          ) : null}
        </div>
      </form>
      {!isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Try an example:</span>
          <button
            type="button"
            onClick={() => onUrlChange(EXAMPLE_URL)}
            className="rounded-full bg-muted px-2 py-0.5 font-mono hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {EXAMPLE_URL}
          </button>
        </div>
      ) : null}
    </div>
  );
}
