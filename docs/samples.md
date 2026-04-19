//correct JSON output for vercel.com
{
  "report": {
    "url": "https://vercel.com/",
    "generatedAt": "2026-04-19T07:15:02.673Z",
    "executiveSummary": "The Vercel homepage is in a critically under-optimized performance posture, scoring 43/100 on PageSpeed Insights. Three of four specialist lanes produced actionable findings: the bundle lane flagged severe JavaScript bloat as the dominant bottleneck, the image lane identified zero-dimension SVGs causing layout instability, and the CWV lane confirmed a 12.1s LCP and 1.3s TBT — both well outside acceptable thresholds. The cache lane found no issues, meaning CDN delivery is working correctly and the performance deficit is entirely client-side. The CWV lane did not produce discrete findings of its own but corroborated the bundle and image signals; its summary is accounted for in context.\n\nThe single most important fix is eliminating the 880 KiB of unused JavaScript currently shipped on every page load. With a 4.1-second interactivity penalty tied directly to dead code — some chunks running 99.8% unused — this is the clearest high-leverage action available. Enabling the React Compiler and aggressively code-splitting these chunks will reduce TBT and unblock LCP render. Behind that, the 2.4-second script bootup cost (another react-compiler opportunity) compounds the problem and should be addressed in the same pass via memoization of hot-path components. Once the JavaScript surface is reduced, fixing zero-dimension SVGs is a low-effort, high-confidence cleanup that closes the remaining layout-shift and accessibility risk and recovers a further ~50ms.\n\nThe engineering team should prioritize the bundle work first — it is the primary driver of the failing LCP (12.1s) and elevated TBT (1.3s) — then layer in the SVG dimension fix as a fast follow. Cache configuration is healthy and does not require action at this time. If LCP does not recover sufficiently after bundle remediation, revisiting geographic CDN distribution and image format optimization for the LCP candidate image would be the next logical investigation.",
    "topPriority": {
      "id": "unused-js-bundle",
      "title": "880 KiB of unused JavaScript loaded on page",
      "severity": "critical",
      "confidence": 1,
      "category": "bundle",
      "affectedResources": [
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0zeod0hmh5n1i.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0v_92f800dik1.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1xwg-6kkipjgj.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/2ep6kg93lfk0b.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0p4kaafh2wtb5.js"
      ],
      "estimatedImpact": "~880 KiB reduction; ~4.1s faster interactive time",
      "vercelFeatureId": "react-compiler",
      "evidence": "unused-javascript audit: 901KB wasted (overallSavingsMs=4130), primarily in 0zeod0hmh5n1i.js (99.8% unused), 0v_92f800dik1.js (99.3% unused), and 1xwg-6kkipjgj.js (69.4% unused)"
    },
    "findings": [
      {
        "id": "unused-js-bundle",
        "title": "880 KiB of unused JavaScript loaded on page",
        "severity": "critical",
        "confidence": 1,
        "category": "bundle",
        "affectedResources": [
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0zeod0hmh5n1i.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0v_92f800dik1.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1xwg-6kkipjgj.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/2ep6kg93lfk0b.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0p4kaafh2wtb5.js"
        ],
        "estimatedImpact": "~880 KiB reduction; ~4.1s faster interactive time",
        "vercelFeatureId": "react-compiler",
        "evidence": "unused-javascript audit: 901KB wasted (overallSavingsMs=4130), primarily in 0zeod0hmh5n1i.js (99.8% unused), 0v_92f800dik1.js (99.3% unused), and 1xwg-6kkipjgj.js (69.4% unused)"
      },
      {
        "id": "heavy-bootup-time",
        "title": "2.4s bootup time driven by expensive client-side JavaScript execution",
        "severity": "high",
        "confidence": 0.95,
        "category": "bundle",
        "affectedResources": [
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1-65qcxzqctbe.js",
          "https://vercel.com/"
        ],
        "estimatedImpact": "~1.6s reduction in scripting cost via memoization optimization",
        "vercelFeatureId": "react-compiler",
        "evidence": "bootup-time audit: 2.4s total (score=0); 1-65qcxzqctbe.js shows 1652ms scripting + 32ms parse/compile; inline chunk shows 788ms with 53ms scripting"
      },
      {
        "id": "img-zero-dimensions",
        "title": "Multiple SVG images have zero dimensions (0x0), breaking layout and accessibility",
        "severity": "high",
        "confidence": 0.95,
        "category": "image",
        "affectedResources": [
          "/vc-ap-vercel-marketing/_next/static/immutable/media/arrow-right.27jx3s6fu89zy.svg",
          "/vc-ap-vercel-marketing/_next/static/immutable/media/chevron-circle-right-fill.3c2nf59jn_1cn.svg"
        ],
        "estimatedImpact": "Prevents layout shift, improves accessibility for screen readers, ~50ms render time savings",
        "vercelFeatureId": "next-image-priority",
        "evidence": "Six images (indices 6, 9, 10, 13, 16, 19, 20) report size=0x0; next/image component used but dimensions not provided. SVG files need explicit width/height or viewBox to render correctly."
      }
    ]
  },
  "degradedSpecialists": [],
  "htmlBlocked": false
}

//second correct JSON output for vercel.com
{
  "report": {
    "url": "https://vercel.com/",
    "generatedAt": "2026-04-19T07:18:55.637Z",
    "executiveSummary": "Vercel's homepage scores 50/100 on performance, with LCP at 6.3s and TBT at 1,310ms as the primary CWV failures — both well outside acceptable thresholds. The bundle specialist identified the dominant contributors: 930 KiB of unused JavaScript and a 2.3s bootup time driven by heavy client-side parsing. The image specialist flagged a medium-severity SVG sizing issue affecting layout shift stability. The cache lane found no issues — edge delivery and caching posture are sound — and the CWV specialist confirmed its findings route entirely through the bundle and image lanes rather than surfacing independent fixes. No data was lost to specialist failure; all four lanes completed.\n\nThe single highest-leverage fix is eliminating the 930 KiB of dead JavaScript. Nearly all of the top five chunks are over 99% unused on initial load, meaning the browser is parsing and compiling code that never runs — directly inflating bootup time and blocking the main thread for hundreds of milliseconds. Addressing this through code-splitting and deferred loading of non-critical scripts (via Next.js Script strategy adjustments) will cascade into LCP and TBT improvements simultaneously. Behind it, enabling the React Compiler to reduce client-component re-render overhead is the next highest-return investment, with an estimated 800ms–1.2s reduction in task-blocking time. Finally, adding explicit width and height attributes to the six zero-dimension SVG icons is a low-effort cleanup that guards against layout shift and stabilizes icon rendering — a fast win once the JavaScript work is underway.",
    "topPriority": {
      "id": "bundle-unused-js-930kib",
      "title": "930 KiB of unused JavaScript blocks page performance",
      "severity": "critical",
      "confidence": 1,
      "category": "bundle",
      "affectedResources": [
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0zeod0hmh5n1i.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0v_92f800dik1.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1xwg-6kkipjgj.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/2ep6kg93lfk0b.js",
        "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0p4kaafh2wtb5.js"
      ],
      "estimatedImpact": "~300ms bootup reduction, ~930 KiB fewer bytes on initial load",
      "vercelFeatureId": "next-script-strategy",
      "evidence": "unused-javascript audit shows 930660 bytes wasted (99.8% of 0zeod0hmh5n1i.js, 99.3% of 0v_92f800dik1.js). Top 5 chunks account for 90%+ of waste."
    },
    "findings": [
      {
        "id": "bundle-unused-js-930kib",
        "title": "930 KiB of unused JavaScript blocks page performance",
        "severity": "critical",
        "confidence": 1,
        "category": "bundle",
        "affectedResources": [
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0zeod0hmh5n1i.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0v_92f800dik1.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1xwg-6kkipjgj.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/2ep6kg93lfk0b.js",
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/0p4kaafh2wtb5.js"
        ],
        "estimatedImpact": "~300ms bootup reduction, ~930 KiB fewer bytes on initial load",
        "vercelFeatureId": "next-script-strategy",
        "evidence": "unused-javascript audit shows 930660 bytes wasted (99.8% of 0zeod0hmh5n1i.js, 99.3% of 0v_92f800dik1.js). Top 5 chunks account for 90%+ of waste."
      },
      {
        "id": "bundle-bootup-2.3s",
        "title": "2.3s bootup time driven by heavy client-side JavaScript parsing and execution",
        "severity": "high",
        "confidence": 0.95,
        "category": "bundle",
        "affectedResources": [
          "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/1-65qcxzqctbe.js",
          "https://vercel.com/"
        ],
        "estimatedImpact": "~800ms–1.2s TBT reduction with React Compiler optimization",
        "vercelFeatureId": "react-compiler",
        "evidence": "bootup-time audit reports 2338ms total, with 1604ms scripting in 1-65qcxzqctbe.js and 145ms scripting in main document. Indicates heavy client-component work on load."
      },
      {
        "id": "unsized-svg-icons",
        "title": "SVG icons with zero dimensions lack explicit width/height",
        "severity": "medium",
        "confidence": 0.85,
        "category": "image",
        "affectedResources": [
          "/vc-ap-vercel-marketing/_next/static/immutable/media/arrow-right.27jx3s6fu89zy.svg (indices 6, 9, 10, 13, 16)",
          "/vc-ap-vercel-marketing/_next/static/immutable/media/chevron-circle-right-fill.3c2nf59jn_1cn.svg (indices 19, 20)"
        ],
        "estimatedImpact": "Layout shift prevention; improved icon rendering consistency",
        "vercelFeatureId": "next-image-priority",
        "evidence": "Six SVG images have width=0 height=0. Intrinsic SVG dimensions must be set via width/height props or CSS to prevent layout shift and render correctly in next/image."
      }
    ]
  },
  "degradedSpecialists": [],
  "htmlBlocked": false
}
