import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers that read binary documents run only on the server, as plain Node modules.
  serverExternalPackages: ["unpdf", "mammoth", "xlsx", "jszip"],
};

export default nextConfig;
