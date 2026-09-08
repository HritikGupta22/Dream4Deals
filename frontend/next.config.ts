import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
  },
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/webhooks/:path*", destination: `${backend}/webhooks/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS - only on production
          process.env.NODE_ENV === "production"
            ? { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }
            : { key: "Strict-Transport-Security", value: "max-age=0" },
          // CSP - restrictive by default
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' *.vercel.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' localhost:3000 localhost:3001 *.onrender.com *.vercel.app *.ngrok-free.dev *.ngrok.io https://broiler-styling-shucking.ngrok-free.dev",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
