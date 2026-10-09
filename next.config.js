/** @type {import('next').NextConfig} */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

// CSP is intentionally scoped to exactly what this app needs (self + your
// Supabase project's API/auth/storage endpoints) rather than left wide open.
// Meta Pixel and Google tag hosts are allowed so conversion tracking works once the IDs are set. Tighten further once you add other third-party
// scripts -- adding a source here should be a deliberate decision each time,
// not something reflexively pasted in as "just in case."
const contentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://connect.facebook.net https://www.googletagmanager.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://tile.openstreetmap.org https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com ${supabaseUrl};
  media-src 'self' blob: ${supabaseUrl};
  font-src 'self';
  connect-src 'self' ${supabaseUrl} https://www.facebook.com https://connect.facebook.net https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
`.replace(/\s{2,}/g, " ").trim();
// next/font self-hosts Inter/Plus Jakarta Sans at build time (app/layout.tsx)
// -- no runtime request to fonts.googleapis.com/gstatic.com, so no CSP
// allowance needed for them.

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // HSTS: only meaningful over HTTPS (production). preload requires you to
  // actually submit the domain at hstspreload.org once you have one -- don't
  // add "preload" to the directive until you're sure you want that.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Phone photos and PDFs go through server actions; the 1MB default made
    // larger uploads fail with no message. Netlify functions cap request bodies at about 6MB, so that is the practical ceiling; the upload screens now show a clear message above it.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
