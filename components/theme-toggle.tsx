"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeChoice = "light" | "dark";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) {
    return (
      <div
        className="inline-flex h-7 w-[56px] items-center justify-center rounded-lg border border-border bg-muted/40 p-0.5"
        aria-hidden
      />
    );
  }

  // Default to dark on first paint — matches the layout's defaultTheme so
  // the toggle reflects the actual rendered theme rather than briefly
  // showing "light" highlighted while the body class says dark.
  const active: ThemeChoice = theme === "light" ? "light" : "dark";

  return (
    <div
      className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5"
      role="group"
      aria-label="Theme"
    >
      {(
        [
          ["light", Sun, "Light"],
          ["dark", Moon, "Dark"],
        ] as const
      ).map(([value, Icon, label]) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "rounded-md text-muted-foreground hover:text-foreground",
            active === value && "bg-background text-foreground shadow-sm",
          )}
          aria-pressed={active === value}
          aria-label={label}
          onClick={() => setTheme(value)}
        >
          <Icon className="size-3.5" aria-hidden />
        </Button>
      ))}
    </div>
  );
}
