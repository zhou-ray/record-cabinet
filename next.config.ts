import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment identity is stable across build and server startup; timestamps are not.
  env: { NEXT_PUBLIC_APP_VERSION: `beta-${process.env.VERCEL_URL?.split(".")[0] ?? "local"}` },
  // Spotify OAuth uses the explicit loopback host rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
