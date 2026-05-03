# Copy-as-Markdown Feature

## Overview

Each finding card now includes a copy button that exports the finding as formatted markdown, ready to be pasted into Slack, Notion, Linear, Jira, or any other tool that supports markdown.

## Usage

1. Run an analysis on any URL
2. Locate the finding you want to share
3. Click the copy icon (📋) in the top-right corner of the finding card
4. Paste the markdown into your preferred tool

## Markdown Format

The exported markdown includes:

- **Severity badge** with color-coded emoji (🔴 critical, 🟠 high, 🟡 medium, 🔵 opportunity)
- **Title** as a heading
- **Confidence score** as a percentage
- **Evidence** explaining why this issue was flagged
- **Estimated impact** (e.g., "~800ms LCP improvement")
- **Affected resources** (up to 5 resources shown, with a count of additional resources)
- **Recommended Vercel feature** with links to both Vercel and Next.js documentation
- **Implementation effort** (low/medium/high)

## Example Output

```markdown
## 🔴 LCP image lacks priority attribute

**Severity:** CRITICAL
**Confidence:** 95%

### Evidence
The Largest Contentful Paint element is an <img> without the priority attribute. This forces the browser to discover it late in the parsing phase, delaying render.

### Estimated Impact
~800ms LCP improvement

### Affected Resources
- `https://example.com/hero-image.jpg`
- `https://example.com/images/banner.png`

### Recommended Vercel Feature
**Image Optimization via next/image**

- [Vercel docs](https://vercel.com/docs/image-optimization)
- [Next.js docs](https://nextjs.org/docs/app/api-reference/components/image)

**Effort:** low
```

## Toast Notifications

- **Success**: "Copied to clipboard" toast appears in bottom-right
- **Error**: If clipboard access fails, an error toast explains why

## Technical Implementation

- **Library**: `sonner` for toast notifications
- **Clipboard API**: Native `navigator.clipboard.writeText()`
- **Format function**: `lib/format-markdown.ts`
- **Component**: `app/_components/finding-card.tsx`

## Testing

Run the demo script to see example markdown output:

```bash
npx tsx scripts/test-markdown-format.ts
```
