// Token-economical projection of a Lighthouse audit's `details` payload.
// Lighthouse's per-audit `details` carries the load-bearing information
// (overall savings, per-asset items) but full payloads can run thousands of
// chars. We pick the keys specialists actually reason over, slice items to
// keep multi-row audits bounded, and cap the JSON output so a single tool
// call can return multiple audits without blowing out a Haiku context window.
//
// Extracted in Day 2 Chunk 2 once cache + cwv joined image as callers
// (Rule of Three). image.ts originally inlined this; cache.ts and cwv.ts
// reference it from here. Pure function, no I/O, no deps.

export interface SummarizeOpts {
  itemCap?: number;
  charCap?: number;
}

const DEFAULT_ITEM_CAP = 5;
const DEFAULT_CHAR_CAP = 1500;

export function summarizeAuditDetails(
  details: unknown,
  opts: SummarizeOpts = {},
): string | null {
  if (!details || typeof details !== "object") return null;

  const itemCap = opts.itemCap ?? DEFAULT_ITEM_CAP;
  const charCap = opts.charCap ?? DEFAULT_CHAR_CAP;

  const obj = details as Record<string, unknown>;
  const pick: Record<string, unknown> = {};
  for (const key of ["overallSavingsMs", "overallSavingsBytes", "type"]) {
    if (key in obj) pick[key] = obj[key];
  }
  if (Array.isArray(obj.items)) {
    pick.items = obj.items.slice(0, itemCap);
  }

  const compact = JSON.stringify(pick);
  return compact.length > charCap ? truncate(compact, charCap) : compact;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
