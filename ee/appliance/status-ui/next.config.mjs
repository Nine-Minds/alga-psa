import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  distDir: 'dist',
  turbopack: {
    root: path.resolve(process.cwd(), '../../..'),
  },
};

export default nextConfig;
