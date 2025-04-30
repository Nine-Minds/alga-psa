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

    // Enable WebAssembly experiments
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      // layers: true, // Might be needed depending on the setup
    };

    // If running on serverless target, ensure wasm files are copied
    if (!isServer) {
      config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    } else {
      config.output.webassemblyModuleFilename = '../static/wasm/[modulehash].wasm';
    }


    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // Increase limit for WASM uploads
    }
  }
};

export default nextConfig;
