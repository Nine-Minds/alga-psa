import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@blocknote/core', '@blocknote/react', '@blocknote/mantine'],
  webpack: (config, { isServer }) => {
    // Disable webpack cache
    config.cache = false;

    // Add support for importing from ee/server/src using absolute paths
    // and ensure packages from root workspace are resolved
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        '.js': ['.js', '.ts', '.tsx']
      },
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
        'querystring': require.resolve('querystring-es3'),
      }
    };

    // Exclude database dialects we don't use
    config.externals = [
      ...config.externals || [],
      'oracledb',
      'mysql',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
      'tedious'
    ];

    return config;
  },
};

export default nextConfig;
