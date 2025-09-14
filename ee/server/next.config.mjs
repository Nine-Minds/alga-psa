import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const isEE = process.env.EDITION === 'ee';

const nextConfig = {
  transpilePackages: [
    '@product/extensions',
    '@product/extensions-pages',
  ],
  turbopack: {
    // Alias optional DB drivers we don't use to an empty shim for Turbopack
    resolveAlias: {
      // Aliases for paths
      '@': './src',
      // Map EE pseudo-namespace to local src to allow bundling
      '@ee/*': './src/*',
      // Feature swap: Extensions route entry
      '@product/extensions/entry': isEE
        ? '../packages/product-extensions/ee/entry'
        : '../packages/product-extensions/oss/entry',
      // Feature swap: Extensions pages under Settings
      '@product/extensions/pages/list': isEE
        ? '../packages/product-extensions-pages/ee/list'
        : '../packages/product-extensions-pages/oss/list',
      '@product/extensions/pages/details': isEE
        ? '../packages/product-extensions-pages/ee/details'
        : '../packages/product-extensions-pages/oss/details',
      '@product/extensions/pages/settings': isEE
        ? '../packages/product-extensions-pages/ee/settings'
        : '../packages/product-extensions-pages/oss/settings',
      // Native DB drivers not used
      'better-sqlite3': emptyShim,
      'sqlite3': emptyShim,
      'mysql': emptyShim,
      'mysql2': emptyShim,
      'oracledb': emptyShim,
      'tedious': emptyShim,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // NOTE: This webpack config is kept for fallback compatibility when Turbopack isn't used
    // The equivalent settings are now configured in the turbopack section above

    // Speed up builds
    config.cache = true;

    // Helpful aliases and module resolution
    config.resolve = {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        '@': path.join(__dirname, 'src'),
        // Match Turbopack EE aliasing behavior
        '@ee': path.join(__dirname, 'src'),
        // Feature swap aliases (Webpack)
        '@product/extensions/entry': isEE
          ? path.join(__dirname, '../packages/product-extensions/ee/entry.tsx')
          : path.join(__dirname, '../packages/product-extensions/oss/entry.tsx'),
        '@product/extensions/pages/list': isEE
          ? path.join(__dirname, '../packages/product-extensions-pages/ee/list.tsx')
          : path.join(__dirname, '../packages/product-extensions-pages/oss/list.tsx'),
        '@product/extensions/pages/details': isEE
          ? path.join(__dirname, '../packages/product-extensions-pages/ee/details.tsx')
          : path.join(__dirname, '../packages/product-extensions-pages/oss/details.tsx'),
        '@product/extensions/pages/settings': isEE
          ? path.join(__dirname, '../packages/product-extensions-pages/ee/settings.tsx')
          : path.join(__dirname, '../packages/product-extensions-pages/oss/settings.tsx'),
      },
      modules: [
        ...(config.resolve?.modules || ['node_modules']),
        // Root workspace node_modules
        path.join(__dirname, '../../node_modules'),
      ],
    };

    // Exclude optional DB drivers and sharp to prevent bundling/resolve errors
    config.externals = [
      ...(config.externals || []),
      'oracledb',
      'mysql',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
      'tedious',
      'sharp', // Externalize sharp to prevent webpack bundling issues
    ];

    // Treat .mjs in node_modules as JS auto
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
      resolve: { fullySpecified: false },
    });

    // Exclude flow CSS modules that can cause build issues
    config.module.rules.push({
      test: /\.module\.css$/,
      include: path.resolve(__dirname, 'src/components/flow'),
      use: 'null-loader',
    });

    return config;
  },
};

export default nextConfig;
