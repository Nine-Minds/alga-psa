/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@blocknote/core', '@blocknote/react', '@blocknote/mantine'],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
    instrumentationHook: false
  }
};

export default nextConfig;