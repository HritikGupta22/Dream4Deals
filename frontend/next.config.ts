import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:3000/api/:path*" },
      { source: "/webhooks/:path*", destination: "http://localhost:3000/webhooks/:path*" },
    ];
  },
};

export default nextConfig;
