import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "firebase-admin",
    "@google-cloud/firestore",
    "pdf-parse",
    "@napi-rs/canvas",
    "playwright",
    "playwright-core",
    "mammoth",
    "word-extractor",
  ],
};

export default nextConfig;
