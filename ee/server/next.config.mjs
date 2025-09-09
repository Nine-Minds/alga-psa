import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
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
