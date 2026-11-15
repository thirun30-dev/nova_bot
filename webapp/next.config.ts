import type { NextConfig } from "next";

// Static export: `npm run build` writes plain HTML/JS/CSS to out/, which
// scripts/export.mjs copies into ../web. nova_dashboard.py serves it, so the
// robot needs no Node.js at runtime. (cacheComponents / partialPrefetching from the
// template need a Node server, so they are off.)
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true, // /map -> map/index.html, served as-is by the Python server
  images: { unoptimized: true },
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
