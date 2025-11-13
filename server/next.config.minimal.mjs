const serverActionsBodyLimit = process.env.SERVER_ACTIONS_BODY_LIMIT || '20mb';

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
