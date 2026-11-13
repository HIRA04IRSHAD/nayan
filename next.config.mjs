// A stamp per build (or per dev-server start). The page registers /sw.js?v=<stamp>, so every new build installs a
// new service worker with its own cache, and the old cache is deleted (public/sw.js, lib/pwa.ts).
const buildId = Date.now().toString(36);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The medicine index is read from disk at runtime; make sure it is deployed with the lookup function.
  outputFileTracingIncludes: {
    "/api/drugs/lookup": ["./data/medicines.json.gz"],
  },
  env: {
    NAYAN_BUILD_ID: buildId,
  },
  async headers() {
    return [
      {
        // The browser must always see the current worker script, never a cached copy.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
