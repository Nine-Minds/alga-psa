/** @type {import('next').NextConfig} */
import process from 'node:process';
import path from 'path';
import { fileURLToPath } from 'url';
import console from 'console';
import { config } from 'dotenv';

config({override: true});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'knex',
      'handlebars',
      'fs',
      'path',
      'crypto',
      'fs/promises',
      'stream',
      'stream/promises',
      'util',
      'url',
      'querystring'
    ],
  },
  webpack: (config, { isServer }) => {
    // Disable webpack cache
    config.cache = false;
    
    // Handle Handlebars module
    if (isServer) {
      config.module.rules.push({
        test: /node_modules\/handlebars\/lib\/.*\.js$/,
        loader: 'null-loader'
      });
    }
    
    // Add support for importing from ee/server/src using absolute paths
    // and ensure packages from root workspace are resolved
    config.resolve = {
      ...config.resolve,
      alias: {
        ...config.resolve.alias,
        '@ee': process.env.NEXT_PUBLIC_EDITION === 'enterprise' 
          ? path.join(__dirname, '../ee/server/src')
          : path.join(__dirname, 'src/empty'), // Point to empty implementations for CE builds
      },
      modules: [
        ...config.resolve.modules || ['node_modules'],
        path.join(__dirname, '../node_modules')
      ],
      fallback: {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        util: false,
        url: false,
        querystring: false,
      }
    };
    
    return config;
  },
  env: {
    EDITION: process.env.NEXT_PUBLIC_EDITION,
  }
}

export default nextConfig;
