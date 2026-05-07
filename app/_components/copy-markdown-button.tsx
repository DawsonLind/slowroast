"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Finding } from "@/lib/schemas";
import { formatFindingAsMarkdown } from "@/lib/format-markdown";
import { cn } from "@/lib/utils";

// Small icon button on each FindingCard that copies the finding to the
// clipboard as Markdown. Feedback is in-button (icon + color swap) — no toast
// library, no portal, no extra dependency. Reverts to idle after a short delay
// so a second click feels live.
const RESET_AFTER_MS = 1800;

type CopyState = "idle" | "copied" | "error";

export function CopyMarkdownButton({ finding }: { finding: Finding }) {
  const [state, setState] = useState<CopyState>("idle");

  async function handleClick() {
    const md = formatFindingAsMarkdown(finding);
    try {
      await navigator.clipboard.writeText(md);
      setState("copied");
    } catch {
      // Clipboard API can fail on insecure contexts or when the document
      // isn't focused. Surface that visually rather than silently swallowing.
      setState("error");
    }
    window.setTimeout(() => setState("idle"), RESET_AFTER_MS);
  }

  const isCopied = state === "copied";
  const isError = state === "error";

  return (
    <button
      type="button"
      onClick={handleClick}
      title={
        isCopied ? "Copied!" : isError ? "Copy failed" : "Copy as Markdown"
      }
      aria-label={
        isCopied
          ? "Finding copied to clipboard"
          : isError
            ? "Copy failed - clipboard unavailable"
            : "Copy finding as Markdown"
      }
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isCopied && "text-[color:var(--color-roast-positive)]",
        isError && "text-destructive",
      )}
    >
      {isCopied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
