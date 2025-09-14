import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import webpack from 'webpack';
// import CopyPlugin from 'copy-webpack-plugin';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine if this is an EE build
const isEE = process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),  // Point to the actual project root
    // Alias optional DB drivers we don't use to an empty shim for Turbopack
    resolveAlias: {
      // Native DB drivers not used
      'better-sqlite3': emptyShim,
      'sqlite3': emptyShim,
      'mysql': emptyShim,
      'mysql2': emptyShim,
      'oracledb': emptyShim,
      'tedious': emptyShim,
      // Knex dialect modules we don't use; alias directly to avoid cascading requires
      'knex/lib/dialects/sqlite3': emptyShim,
      'knex/lib/dialects/sqlite3/index.js': emptyShim,
      'knex/lib/dialects/mysql': emptyShim,
      'knex/lib/dialects/mysql/index.js': emptyShim,
      'knex/lib/dialects/mysql2': emptyShim,
      'knex/lib/dialects/mysql2/index.js': emptyShim,
      'knex/lib/dialects/mssql': emptyShim,
      'knex/lib/dialects/mssql/index.js': emptyShim,
      'knex/lib/dialects/oracledb': emptyShim,
      'knex/lib/dialects/oracledb/index.js': emptyShim,
      'knex/lib/dialects/oracledb/utils.js': emptyShim,

      // Product feature aliasing - point stable import paths to OSS or EE implementations
      '@product/extensions/entry': isEE
        ? '@product/extensions/ee/entry'
        : '@product/extensions/oss/entry',
      '@product/settings-extensions/entry': isEE
        ? '@product/settings-extensions/ee/entry'
        : '@product/settings-extensions/oss/entry',
      '@product/chat/entry': isEE
        ? '@product/chat/ee/entry'
        : '@product/chat/oss/entry',
      '@product/email-providers/entry': isEE
        ? '@product/email-providers/ee/entry'
        : '@product/email-providers/oss/entry',
      '@product/workflows/entry': isEE
        ? '@product/workflows/ee/entry'
        : '@product/workflows/oss/entry',
      '@product/billing/entry': isEE
        ? '@product/billing/ee/entry'
        : '@product/billing/oss/entry',
      '@product/auth-ee/entry': isEE
        ? '@product/auth-ee/ee/entry'
        : '@product/auth-ee/oss/entry',
      '@product/extension-actions/entry': isEE
        ? '@product/extension-actions/ee/entry'
        : '@product/extension-actions/oss/entry',
      '@product/extension-initialization/entry': isEE
        ? '@product/extension-initialization/ee/entry'
        : '@product/extension-initialization/oss/entry',
    },
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false, // Disabled to prevent double rendering in development
  transpilePackages: [
    '@blocknote/core',
    '@blocknote/react',
    '@blocknote/mantine',
    '@emoji-mart/data',
    // Product feature packages
    '@product/extensions',
    '@product/settings-extensions',
    '@product/chat',
    '@product/email-providers',
    '@product/workflows',
    '@product/billing',
    // New aliasing packages
    '@alga-psa/product-extension-actions',
    '@alga-psa/product-auth-ee',
    '@alga-psa/product-extension-initialization'
  ],
  // Rewrites required for PostHog
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
      {
        source: '/ingest/decide',
        destination: 'https://us.i.posthog.com/decide',
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  webpack: (config, { isServer, dev }) => {
    // Enable webpack cache for faster builds
    config.cache = true;

    // Add support for importing from ee/server/src using absolute paths
    // and ensure packages from root workspace are resolved
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs'],
        '.jsx': ['.tsx', '.jsx']
      },
      alias: {
        ...config.resolve.alias,
        '@': path.join(__dirname, 'src'),
        '@ee': process.env.NEXT_PUBLIC_EDITION === 'enterprise'
          ? path.join(__dirname, '../ee/server/src')
          : path.join(__dirname, 'src/empty'), // Point to empty implementations for CE builds
        // Also map deep EE paths used without the @ee alias to CE stubs
        // This ensures CE builds don't fail when code references ee/server/src directly
        'ee/server/src': process.env.NEXT_PUBLIC_EDITION === 'enterprise'
          ? path.join(__dirname, '../ee/server/src')
          : path.join(__dirname, 'src/empty'),

        // Product package aliases - point to the packages directory
        '@product/extensions': path.join(__dirname, '../packages/product-extensions'),
        '@product/settings-extensions': path.join(__dirname, '../packages/product-settings-extensions'),
        '@product/chat': path.join(__dirname, '../packages/product-chat'),
        '@product/email-providers': path.join(__dirname, '../packages/product-email-providers'),
        '@product/workflows': path.join(__dirname, '../packages/product-workflows'),
        '@product/billing': path.join(__dirname, '../packages/product-billing'),
        '@alga-psa/product-extension-actions': path.join(__dirname, '../packages/product-extension-actions'),
        '@alga-psa/product-auth-ee': path.join(__dirname, '../packages/product-auth-ee'),
        '@alga-psa/product-extension-initialization': path.join(__dirname, '../packages/product-extension-initialization')
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

    // Exclude database dialects we don't use and heavy dev dependencies
    config.externals = [
      ...config.externals || [],
      'oracledb',
      'mysql',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
      'tedious'
    ];

    // Externalize ts-morph for both client and server to prevent bundling issues
    // ts-morph is a huge library that shouldn't be bundled
    config.externals.push('ts-morph');

    // Rule to handle .wasm files as assets
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/wasm/[name].[hash][ext]',
      },
    });

    // Ensure .mjs files in node_modules are treated as JS auto (handles import.meta)
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
      resolve: {
        fullySpecified: false, // Needed for some packages that omit extensions
      },
    });

    // Exclude flow components CSS files to prevent autoprefixer issues during build
    config.module.rules.push({
      test: /\.module\.css$/,
      include: path.resolve(__dirname, '../ee/server/src/components/flow'),
      use: 'null-loader',
    });

    // Enable WebAssembly experiments (temporarily disabled for debugging)
    // config.experiments = {
    //   ...config.experiments,
    //   asyncWebAssembly: true,
    //   // layers: true, // Might be needed depending on the setup
    // };

    // If running on serverless target, ensure wasm files are copied
    if (!isServer) {
      config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    } else {
      config.output.webassemblyModuleFilename = '../static/wasm/[modulehash].wasm';

      // Copy the AssemblyScript source files needed at runtime for standard template sync
      // config.plugins.push(
      //   new CopyPlugin({
      //     patterns: [
      //       {
      //         from: path.resolve(__dirname, 'src/invoice-templates/assemblyscript'),
      //         // Copy to a location relative to the server build output (.next/server/)
      //         // so that path.resolve(process.cwd(), 'src/...') works at runtime
      //         to: path.resolve(config.output.path, 'src/invoice-templates/assemblyscript'),
      //         // Filter to only include necessary files if needed, but copying the whole dir is simpler
      //         // filter: async (resourcePath) => resourcePath.endsWith('.ts') || resourcePath.includes('/standard/'),
      //         globOptions: {
      //           ignore: [
      //             // Ignore temporary or build artifact directories if they exist within
      //             '**/temp_compile/**',
      //             '**/node_modules/**',
      //             '**/*.wasm', // Don't copy wasm files this way
      //             '**/*.js', // Don't copy compiled JS
      //             '**/package.json',
      //             '**/tsconfig.json',
      //           ],
      //         },
      //       },
      //     ],
      //   })
      // );
    }

    // In CE builds, replace any deep import of the EE S3 provider with the CE stub.
    // This also catches relative paths like ../../../ee/server/src/lib/storage/providers/S3StorageProvider
    // and @ee alias imports like @ee/lib/storage/providers/S3StorageProvider
    if (process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /(.*)(ee[\\\/]server[\\\/]src[\\\/]|@ee[\\\/])lib[\\\/]storage[\\\/]providers[\\\/]S3StorageProvider(\.[jt]s)?$/,
          path.join(__dirname, 'src/empty/lib/storage/providers/S3StorageProvider')
        )
      );
    }

    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // Increase limit for WASM uploads
    }
  },
  // Skip static optimization for error pages
  generateBuildId: async () => {
    return 'build-' + Date.now();
  }
};

export default nextConfig;
