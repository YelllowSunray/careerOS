import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "firebase-admin",
    "@google-cloud/firestore",
    "pdf-parse",
    "playwright",
    "mammoth",
    "word-extractor",
  ],
};

export default nextConfig;
