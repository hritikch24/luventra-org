import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // A package-lock.json in the parent folder otherwise wins root inference.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
