import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const nextConfig = {
  turbopack: {
    // Alias optional DB drivers we don't use to an empty shim for Turbopack
    resolveAlias: {
      // Aliases for paths
      '@': './src',
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
