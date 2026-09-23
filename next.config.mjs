/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['livekit-server-sdk'],
  },
  // Prototype Vite client lives under src/ and must not be treated as Next pages.
  // App Router entry is exclusively app/.
};

export default nextConfig;
