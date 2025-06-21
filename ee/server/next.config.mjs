/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true
  },
  async rewrites() {
    return [
      // Serve extension files from the extensions directory
      {
        source: '/extensions/:extension/dist/:path*',
        destination: '/api/extensions/:extension/static/:path*'
      }
    ];
  }
};

export default nextConfig;