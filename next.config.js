/** @type {import('next').NextConfig} */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

// CSP is intentionally scoped to exactly what this app needs (self + your
// Supabase project's API/auth/storage endpoints) rather than left wide open.
// Tighten further once you add fonts, analytics, or other third-party
// scripts -- adding a source here should be a deliberate decision each time,
// not something reflexively pasted in as "just in case."
const contentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' ${supabaseUrl};
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
`.replace(/\s{2,}/g, " ").trim();

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
