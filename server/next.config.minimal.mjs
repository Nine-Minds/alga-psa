// Same default as next.config.mjs (see the measurement there): keep the two equal.
const serverActionsBodyLimit = process.env.SERVER_ACTIONS_BODY_LIMIT || '26mb';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@blocknote/core', '@blocknote/react', '@blocknote/mantine'],
  experimental: {
    serverActions: {
      bodySizeLimit: serverActionsBodyLimit,
    },
    instrumentationHook: false
  }
};

export default nextConfig;
