import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  agentRules: false,
  typedRoutes: true,
  allowedDevOrigins: (process.env.RENEWAL_DEV_HOSTS ?? "").split(",").map(host => host.trim()).filter(Boolean)
};

export default nextConfig;
