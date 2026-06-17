import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` emits a self-contained ./out folder of HTML/JS/CSS.
  // The FastAPI backend serves that folder directly, so the whole app is one
  // container on one origin (no separate frontend host, no CORS).
  output: "export",
  // A static export has no Next image-optimization server, so opt out.
  images: { unoptimized: true },
};

export default nextConfig;
