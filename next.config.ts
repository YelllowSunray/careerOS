import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "firebase-admin",
    "@google-cloud/firestore",
    "pdf-parse",
    "playwright",
    "playwright-core",
    "mammoth",
    "word-extractor",
  ],
};

export default nextConfig;
