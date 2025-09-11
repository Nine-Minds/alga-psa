import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  experimental: {
    // Allow importing code from outside this directory (monorepo OSS server code)
    externalDir: true,
  },
  images: {
    // Avoid requiring the native `sharp` binary locally
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
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
        // Hard-pin common EE import paths used by CE SettingsPage
        '@ee/lib/extensions/ExtensionComponentLoader': path.join(__dirname, 'src/lib/extensions/ExtensionComponentLoader.tsx'),
        '@ee/components': path.join(__dirname, 'src/components'),
        // Stub native sharp during local dev to avoid platform build issues
        sharp: path.join(__dirname, 'src/empty/sharp.ts'),
      },
      modules: [
        ...(config.resolve?.modules || ['node_modules']),
        // Root workspace node_modules
        path.join(__dirname, '../../node_modules'),
      ],
    };

    // Exclude optional DB drivers not used (prevents bundling/resolve errors)
    config.externals = [
      ...(config.externals || []),
      'oracledb',
      'mysql',
      'mysql2',
      'sqlite3',
      'better-sqlite3',
      'tedious',
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
