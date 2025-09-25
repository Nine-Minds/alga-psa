import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import webpack from 'webpack';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const emptyShim = './src/empty/shims/empty.ts';
const isEE = process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const normalizeRelative = (relativePath) => {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('.')) {
    return normalized;
  }
  return `./${normalized}`;
};

const resolveFromServer = (...segments) => path.join(__dirname, ...segments);
const editionRoot = isEE ? resolveFromServer('../ee/server/src') : resolveFromServer('src/empty');

const editionEntries = [
  { key: '@product/extensions/entry', ee: '../packages/product-extensions/ee/entry.tsx', ce: '../packages/product-extensions/oss/entry.tsx' },
  { key: '@product/settings-extensions/entry', ee: '../packages/product-settings-extensions/ee/entry.tsx', ce: '../packages/product-settings-extensions/oss/entry.tsx' },
  { key: '@product/email-providers/entry', ee: '../packages/product-email-providers/ee/entry.tsx', ce: '../packages/product-email-providers/oss/entry.tsx' },
  { key: '@product/client-portal-domain/entry', ee: '../packages/product-client-portal-domain/ee/entry.tsx', ce: '../packages/product-client-portal-domain/oss/entry.tsx' },
  { key: '@product/workflows/entry', ee: '../packages/product-workflows/ee/entry.ts', ce: './src/components/flow/DnDFlow.tsx' },
  { key: '@product/billing/entry', ee: '../packages/product-billing/ee/entry.ts', ce: '../packages/product-billing/oss/entry.ts' },
  { key: '@product/chat/entry', ee: '../packages/product-chat/ee/entry.tsx', ce: './src/services/chatStreamService' },
  { key: '@product/auth-ee/entry', ee: '../packages/product-auth-ee/ee/entry.ts', ce: '../packages/product-auth-ee/oss/entry.ts' },
  { key: '@product/extension-actions', ee: '../packages/product-extension-actions/ee', ce: '../packages/product-extension-actions/oss' },
  { key: '@product/extension-actions/entry', ee: '../packages/product-extension-actions/ee/entry.ts', ce: '../packages/product-extension-actions/oss/entry.ts' },
  { key: '@product/extension-initialization/entry', ee: '../packages/product-extension-initialization/ee/entry.ts', ce: '../packages/product-extension-initialization/oss/entry.ts' },
  { key: '@alga-psa/product-extension-initialization', ee: '../ee/server/src/lib/extensions/initialize.ts', ce: '../packages/product-extension-initialization/oss/entry.ts' },
  { key: '@alga-psa/product-extension-actions', ee: '../packages/product-extension-actions/ee/entry.ts', ce: '../packages/product-extension-actions/oss/entry.ts' }
];

const optionalDbModules = [
  'better-sqlite3',
  'sqlite3',
  'mysql',
  'mysql2',
  'oracledb',
  'tedious',
  'knex/lib/dialects/sqlite3',
  'knex/lib/dialects/sqlite3/index.js',
  'knex/lib/dialects/mysql',
  'knex/lib/dialects/mysql/index.js',
  'knex/lib/dialects/mysql2',
  'knex/lib/dialects/mysql2/index.js',
  'knex/lib/dialects/mssql',
  'knex/lib/dialects/mssql/index.js',
  'knex/lib/dialects/oracledb',
  'knex/lib/dialects/oracledb/index.js',
  'knex/lib/dialects/oracledb/utils.js'
];

const buildTurbopackAliases = () => {
  const aliases = {
    '@': './src',
    '@emoji-mart/data/sets/15/native.json': normalizeRelative('../node_modules/@emoji-mart/data/sets/15/native.json'),
    '@alga-psa/product-auth-ee': normalizeRelative('../packages/product-auth-ee'),
  };

  const editionRelative = isEE ? '../ee/server/src' : './src/empty';
  aliases['@ee'] = editionRelative;
  aliases['@ee/'] = `${editionRelative}/`;
  aliases['ee/server/src'] = editionRelative;
  aliases['ee/server/src/'] = `${editionRelative}/`;

  editionEntries.forEach(({ key, ee, ce }) => {
    aliases[key] = normalizeRelative(isEE ? ee : ce);
  });

  optionalDbModules.forEach((specifier) => {
    aliases[specifier] = emptyShim;
  });

  return aliases;
};

const buildWebpackAliases = () => {
  const aliases = {
    '@': resolveFromServer('src'),
    '@ee': editionRoot,
    'ee/server/src': editionRoot,
    '@emoji-mart/data/sets/15/native.json': resolveFromServer('../node_modules/@emoji-mart/data/sets/15/native.json'),
    '@alga-psa/product-auth-ee': resolveFromServer('../packages/product-auth-ee'),
  };

  editionEntries.forEach(({ key, ee, ce }) => {
    aliases[key] = resolveFromServer(isEE ? ee : ce);
  });

  return aliases;
};

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),
    resolveAlias: buildTurbopackAliases(),
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  transpilePackages: [
    '@blocknote/core',
    '@blocknote/react',
    '@blocknote/mantine',
    '@emoji-mart/data',
    '@product/extensions',
    '@product/settings-extensions',
    '@product/email-providers',
    '@product/client-portal-domain',
    '@product/billing',
    '@alga-psa/product-extension-actions',
    '@alga-psa/product-auth-ee',
    '@alga-psa/product-extension-initialization'
  ],
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
  skipTrailingSlashRedirect: true,
  webpack: (config, { isServer }) => {
    config.cache = true;

    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs'],
        '.jsx': ['.tsx', '.jsx'],
      },
      alias: {
        ...(config.resolve?.alias || {}),
        ...buildWebpackAliases(),
      },
      modules: [
        ...(config.resolve?.modules || ['node_modules']),
        path.join(__dirname, '../node_modules'),
      ],
      fallback: {
        ...(config.resolve?.fallback || {}),
        querystring: require.resolve('querystring-es3'),
      },
    };

    config.externals = [
      ...(config.externals || []),
      ...optionalDbModules,
      'ts-morph',
    ];

    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/wasm/[name].[hash][ext]',
      },
    });

    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
      resolve: {
        fullySpecified: false,
      },
    });

    config.module.rules.push({
      test: /\.module\.css$/,
      include: path.resolve(__dirname, '../ee/server/src/components/flow'),
      use: 'null-loader',
    });

    if (!isServer) {
      config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    } else {
      config.output.webassemblyModuleFilename = '../static/wasm/[modulehash].wasm';
    }

    if (!isEE) {
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /(.*)(ee[\\\\/]server[\\\\/]src[\\\\/]|@ee[\\\\/])lib[\\\\/]storage[\\\\/]providers[\\\\/]S3StorageProvider(\.[jt]s)?$/,
          path.join(__dirname, 'src/empty/lib/storage/providers/S3StorageProvider')
        )
      );
    }

    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
