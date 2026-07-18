import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "playwright", "mammoth", "word-extractor"],
};

export default nextConfig;
