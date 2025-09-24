import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const isEE = process.env.EDITION === 'ee';

// DEBUG LOGGING - Remove after troubleshooting
console.log('=== EE BUILD DEBUG ===');
console.log('process.env.EDITION:', process.env.EDITION);
console.log('process.env.NEXT_PUBLIC_EDITION:', process.env.NEXT_PUBLIC_EDITION);
console.log('isEE result:', isEE);
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('=== END DEBUG ===');

const nextConfig = {
  // Transpile shared product packages used by EE server
  transpilePackages: [
    '@product/extensions',
    '@product/extensions-pages',
  ],
  // Turbopack-specific aliases
  turbopack: {
    resolveAlias: {
      '@': './src',
      // EE source alias
      '@ee/*': './src/*',
      // Feature swap: product pages and entries
      '@product/extensions/entry': isEE
        ? '../packages/product-extensions/ee/entry'
        : '../packages/product-extensions/oss/entry',
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
  experimental: {
    externalDir: true,
  },
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // NOTE: This webpack config is kept for fallback compatibility when Turbopack isn't used
    // The equivalent settings are now configured in the turbopack section above

    // Speed up builds
    config.cache = true;

    // Helpful aliases and module resolution
    config.resolve = {
      ...config.resolve,
      // Allow .js imports to resolve to TS sources in the monorepo
      extensionAlias: {
        '.js': ['.js', '.ts', '.tsx'],
      },
      alias: {
        ...config.resolve?.alias,
        '@': path.join(__dirname, 'src'),
        // Ensure EE imports resolve to this package's src (EE edition)
        '@ee': path.join(__dirname, 'src'),
        '@ee/lib/extensions/ExtensionComponentLoader': path.join(__dirname, 'src/lib/extensions/ExtensionComponentLoader.tsx'),
        '@ee/components': path.join(__dirname, 'src/components'),
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
        // Stub native sharp during local dev to avoid platform build issues
        sharp: path.join(__dirname, 'src/empty/sharp.ts'),
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
