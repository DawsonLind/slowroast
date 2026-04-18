import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Inverts the caching model: dynamic by default, opt-in to cache via `use cache`.
  // See https://nextjs.org/docs/app/getting-started/caching
  cacheComponents: true,

  // Trust the deployment URL when running behind Vercel's proxy.
  experimental: {
    // Add experimental flags here as needed. Document WHY next to each.
  },
};

export default nextConfig;
