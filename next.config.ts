import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Large CSV imports are sent to the server as one JSON payload.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
