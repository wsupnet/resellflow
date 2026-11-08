// Sent on every response. Deliberately no HSTS: many installs are plain http on a
// LAN, and HSTS would lock browsers out of those. No strict script CSP either —
// Next's inline bootstrap scripts would need per-request nonces.
const securityHeaders = [
  // Nobody can frame the app (clickjacking); also blocks <base>/<object> tricks
  // and form posts to other sites.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" }, // older browsers
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  // Camera only for this app (barcode scanner); nothing else.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Next's file tracing pulls the TypeScript compiler into the standalone server,
  // which never uses it at runtime. Keeps ~9 MB of dev tooling out of the image.
  outputFileTracingExcludes: { "*": ["node_modules/typescript/**"] },
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb"
    }
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
