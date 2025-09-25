import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import webpack from 'webpack';
// import CopyPlugin from 'copy-webpack-plugin';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine if this is an EE build
const isEE = process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

// DEBUG LOGGING - Remove after troubleshooting
console.log('=== CE BUILD DEBUG ===');
console.log('process.env.EDITION:', process.env.EDITION);
console.log('process.env.NEXT_PUBLIC_EDITION:', process.env.NEXT_PUBLIC_EDITION);
console.log('isEE result:', isEE);
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('=== END DEBUG ===');

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const WATCHED_REQUEST_PATTERNS = [
  '@ee',
  'ee/server/src',
  '@product/',
  '../packages/product-extensions',
  '../packages/product-settings-extensions',
  '../packages/product-client-portal-domain',
  '../packages/product-email-providers',
  '../packages/product-extension-actions',
  '../packages/product-extension-initialization',
  '../packages/product-chat',
];

const stripLoaders = (value = '') => {
  if (!value || typeof value !== 'string') return value || '';
  const parts = value.split('!');
  return parts[parts.length - 1];
};

const shouldTraceRequest = (value = '') => {
  const flag = String(process.env.LOG_MODULE_RESOLUTION || '').toLowerCase();
  if (flag !== '1' && flag !== 'true') {
    return false;
  }
  return WATCHED_REQUEST_PATTERNS.some((token) => value.includes(token));
};

const describeMappingTarget = (resolved = '') => {
  if (!resolved) return 'unknown';
  if (resolved.includes('/ee/server/src/')) return 'EE';
  if (resolved.includes('/server/src/empty/')) return 'CE-stub';
  if (resolved.includes('/packages/product-') && !resolved.includes('/oss/')) return 'package-ee-candidate';
  if (resolved.includes('/packages/product-') && resolved.includes('/oss/')) return 'package-oss';
  return 'unknown';
};

const logAliasSnapshot = (aliasMap) => {
  const flag = String(process.env.LOG_MODULE_RESOLUTION || '').toLowerCase();
  if (flag !== '1' && flag !== 'true') {
    return;
  }
  const tracked = [
    '@ee',
    '@product/extensions/entry',
    '@product/settings-extensions/entry',
    '@product/client-portal-domain/entry',
    '@product/email-providers/entry',
    '@product/workflows/entry',
    '@product/billing/entry',
    '@product/chat/entry',
    '@product/extension-actions/entry',
    '@product/extension-initialization/entry',
    '@alga-psa/product-extension-actions',
    '@alga-psa/product-extension-initialization',
  ];

  const snapshot = Object.fromEntries(
    tracked
      .filter((key) => Object.prototype.hasOwnProperty.call(aliasMap, key))
      .map((key) => [key, aliasMap[key]])
  );

  console.log('[edition-aliases] active', snapshot);
};

// Optional verbose module resolution logging (enable with LOG_MODULE_RESOLUTION=1)
class LogModuleResolutionPlugin {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('LogModuleResolutionPlugin', (nmf) => {
      nmf.hooks.beforeResolve.tap('LogModuleResolutionPlugin', (data) => {
        try {
          if (!data) return;
          const rawRequest = data.request || '';
          const normalizedRequest = stripLoaders(rawRequest);
          if (!shouldTraceRequest(normalizedRequest) && !shouldTraceRequest(rawRequest)) {
            return;
          }
          console.log('[resolve:before]', {
            request: rawRequest,
            normalizedRequest,
            issuer: data.contextInfo?.issuer,
            context: data.context,
          });
        } catch {}
      });
      nmf.hooks.afterResolve.tap('LogModuleResolutionPlugin', (result) => {
        try {
          if (!result) return;
          const req = result.createData?.request || result.request || result.rawRequest || '';
          const normalizedRequest = stripLoaders(req);
          const res = result.resource || '';
          const normalizedResource = stripLoaders(res);
          const hit = shouldTraceRequest(req) || shouldTraceRequest(normalizedRequest) || shouldTraceRequest(res) || shouldTraceRequest(normalizedResource);
          if (!hit) return;
          const mappedTo = describeMappingTarget(res || normalizedResource);
          console.log('[resolve:after]', {
            request: req,
            normalizedRequest,
            resource: res,
            normalizedResource,
            mappedTo,
            context: result.context,
            issuer: result.createData?.issuer || result.contextInfo?.issuer,
            descriptionFilePath: result.resourceResolveData?.descriptionFilePath,
          });
        } catch {}
      });
    });
  }
}

class EditionBuildDiagnosticsPlugin {
  constructor(options = {}) {
    this.options = {
      watchedRequests: options.watchedRequests || [
        '@product/chat/entry',
        '@product/extensions/entry',
        '@product/settings-extensions/entry',
        'ee/server/src/app/msp/chat/page',
      ],
    };
  }

  apply(compiler) {
    const shouldLog = String(process.env.LOG_EDITION_DIAGNOSTICS || '').toLowerCase();
    const enabled = shouldLog === '1' || shouldLog === 'true';
    if (!enabled) {
      return;
    }

    compiler.hooks.beforeCompile.tap('EditionBuildDiagnosticsPlugin', () => {
      const editionSnapshot = {
        EDITION: process.env.EDITION,
        NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION,
        NODE_ENV: process.env.NODE_ENV,
        cwd: process.cwd(),
        timestamp: new Date().toISOString(),
      };
      console.log('[edition-diagnostics] build env', editionSnapshot);

      const eePaths = [
        path.join(__dirname, '../ee/server/src/app/msp/chat/page.tsx'),
        path.join(__dirname, '../ee/server/src/components/chat/Chat.tsx'),
      ];

      eePaths.forEach((candidate) => {
        console.log('[edition-diagnostics] ee artifact', {
          path: candidate,
          exists: fs.existsSync(candidate),
        });
      });
    });

    compiler.hooks.normalModuleFactory.tap('EditionBuildDiagnosticsPlugin', (nmf) => {
      nmf.hooks.afterResolve.tap('EditionBuildDiagnosticsPlugin', (result) => {
        if (!result) return;

        const request = result.request || result.rawRequest || '';
        const matched = this.options.watchedRequests.some((token) => request && request.includes(token));
        const resource = result.resource || '';

        if (!matched && !resource.includes('/ee/server/src/')) return;

        const createData = result.createData || {};
        console.log('[edition-diagnostics] module resolution', {
          request,
          resource,
          resolvedResource: resource || createData.resource || createData.resolvedModule,
          resolvedPath: createData.path,
          userRequest: createData.userRequest,
          type: createData.type,
          issuer: result.contextInfo?.issuer,
          descriptionFilePath: result.resourceResolveData?.descriptionFilePath,
        });
      });
    });
  }
}

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),  // Point to the actual project root
    // Alias optional DB drivers we don't use to an empty shim for Turbopack
    resolveAlias: {
      // Fix for emoji-mart data loading in Turbopack
      '@emoji-mart/data/sets/15/native.json': path.join(__dirname, '../node_modules/@emoji-mart/data/sets/15/native.json'),
      // Base app alias
      '@': './src',
      '@ee': isEE ? '../ee/server/src' : './src/empty',
      '@ee/': isEE ? '../ee/server/src/' : './src/empty/',
      'ee/server/src': isEE ? '../ee/server/src' : './src/empty',
      'ee/server/src/': isEE ? '../ee/server/src/' : './src/empty/',
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
        : './src/services/chatStreamService',
      '@product/email-providers/entry': isEE
        ? '@product/email-providers/ee/entry'
        : '@product/email-providers/oss/entry',
      '@product/client-portal-domain/entry': isEE
        ? '@product/client-portal-domain/ee/entry'
        : '@product/client-portal-domain/oss/entry',
      '@product/workflows/entry': isEE
        ? '@product/workflows/ee/entry'
        : '@product/workflows/oss/entry',
      '@product/billing/entry': isEE
        ? '@product/billing/ee/entry'
        : '@product/billing/oss/entry',
      '@product/auth-ee/entry': isEE
        ? '@product/auth-ee/ee/entry'
        : '@product/auth-ee/oss/entry',
      '@product/extension-actions': isEE
        ? '@product/extension-actions/ee'
        : '@product/extension-actions/oss',        
      '@product/extension-actions/entry': isEE
        ? '@product/extension-actions/ee/entry'
        : '@product/extension-actions/oss/entry',
      '@product/extension-initialization/entry': isEE
        ? '@product/extension-initialization/ee/entry'
        : '@product/extension-initialization/oss/entry',
      // Map stable specifiers to relative sources so Turbopack can resolve them
      '@alga-psa/product-extension-initialization': isEE
        ? '../ee/server/src/lib/extensions/initialize'
        : '../packages/product-extension-initialization/oss/entry',
      '@alga-psa/product-extension-actions': isEE
        ? '../packages/product-extension-actions/ee/entry'
        : '../packages/product-extension-actions/oss/entry',
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
    // Product feature packages (only those needed in this app)
    '@product/extensions',
    '@product/settings-extensions',
    '@product/email-providers',
    '@product/client-portal-domain',
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
    const isEE = process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    console.log('[next.config] edition', isEE ? 'enterprise' : 'community', {
      cwd: process.cwd(),
      dirname: __dirname,
      LOG_MODULE_RESOLUTION: process.env.LOG_MODULE_RESOLUTION,
    });

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
        '@ee': isEE
          ? path.join(__dirname, '../ee/server/src')
          : path.join(__dirname, 'src/empty'), // Point to empty implementations for CE builds
        // Also map deep EE paths used without the @ee alias to CE stubs
        // This ensures CE builds don't fail when code references ee/server/src directly
        'ee/server/src': isEE
          ? path.join(__dirname, '../ee/server/src')
          : path.join(__dirname, 'src/empty'),

        // Avoid base-prefix aliases that can shadow more specific '/entry' aliases
        // Feature swap aliases for Webpack (point directly to ts/tsx files)
        '@product/extensions/entry': (() => {
          const eePath = path.join(__dirname, '../packages/product-extensions/ee/entry.tsx');
          const ossPath = path.join(__dirname, '../packages/product-extensions/oss/entry.tsx');
          const selectedPath = isEE ? eePath : ossPath;
          console.log(`[WEBPACK ALIAS DEBUG] @product/extensions/entry -> ${selectedPath} (isEE: ${isEE})`);
          return selectedPath;
        })(),
        '@product/settings-extensions/entry': (() => {
          const eePath = path.join(__dirname, '../packages/product-settings-extensions/ee/entry.tsx');
          const ossPath = path.join(__dirname, '../packages/product-settings-extensions/oss/entry.tsx');
          const selectedPath = isEE ? eePath : ossPath;
          console.log(`[WEBPACK ALIAS DEBUG] @product/settings-extensions/entry -> ${selectedPath} (isEE: ${isEE})`);
          return selectedPath;
        })(),
        '@product/email-providers/entry': isEE
          ? path.join(__dirname, '../packages/product-email-providers/ee/entry.tsx')
          : path.join(__dirname, '../packages/product-email-providers/oss/entry.tsx'),
        '@product/client-portal-domain/entry': isEE
          ? path.join(__dirname, '../packages/product-client-portal-domain/ee/entry.tsx')
          : path.join(__dirname, '../packages/product-client-portal-domain/oss/entry.tsx'),
        '@product/workflows/entry': isEE
          ? path.join(__dirname, '../packages/product-workflows/ee/entry.ts')
          : path.join(__dirname, 'src/components/flow/DnDFlow.tsx'),
        '@product/billing/entry': isEE
          ? path.join(__dirname, '../packages/product-billing/ee/entry.ts')
          : path.join(__dirname, '../packages/product-billing/oss/entry.ts'),
        // Point stable specifiers to exact entry files to avoid conditional exports in package index
        '@alga-psa/product-extension-initialization': isEE
          ? path.join(__dirname, '../ee/server/src/lib/extensions/initialize.ts')
          : path.join(__dirname, '../packages/product-extension-initialization/oss/entry.ts'),
        '@alga-psa/product-extension-actions': isEE
          ? path.join(__dirname, '../packages/product-extension-actions/ee/entry.ts')
          : path.join(__dirname, '../packages/product-extension-actions/oss/entry.ts'),
        '@alga-psa/product-auth-ee': path.join(__dirname, '../packages/product-auth-ee'),
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

    // In EE mode, also alias any absolute CE-stub path prefix to EE source root
    if (isEE) {
      const ceEmptyAbs = path.join(__dirname, 'src', 'empty');
      const eeSrcAbs = path.join(__dirname, '../ee/server/src');
      config.resolve.alias[ceEmptyAbs] = eeSrcAbs;

      const pkgSettingsEntry = path.join(__dirname, '../packages/product-settings-extensions/entry.ts');
      const pkgSettingsEntryIndex = path.join(__dirname, '../packages/product-settings-extensions/entry.tsx');
      const pkgSettingsEeEntry = path.join(__dirname, '../packages/product-settings-extensions/ee/entry.tsx');
      config.resolve.alias[pkgSettingsEntry] = pkgSettingsEeEntry;
      config.resolve.alias[pkgSettingsEntryIndex] = pkgSettingsEeEntry;

      const pkgExtensionsEntry = path.join(__dirname, '../packages/product-extensions/entry.ts');
      const pkgExtensionsEntryIndex = path.join(__dirname, '../packages/product-extensions/entry.tsx');
      const pkgExtensionsEeEntry = path.join(__dirname, '../packages/product-extensions/ee/entry.tsx');
      config.resolve.alias[pkgExtensionsEntry] = pkgExtensionsEeEntry;
      config.resolve.alias[pkgExtensionsEntryIndex] = pkgExtensionsEeEntry;

      const pkgChatEntry = path.join(__dirname, '../packages/product-chat/entry.ts');
      const pkgChatEntryIndex = path.join(__dirname, '../packages/product-chat/entry.tsx');
      const pkgChatEeEntry = path.join(__dirname, '../packages/product-chat/ee/entry.tsx');
      config.resolve.alias[pkgChatEntry] = pkgChatEeEntry;
      config.resolve.alias[pkgChatEntryIndex] = pkgChatEeEntry;

      const pkgClientPortalEntry = path.join(__dirname, '../packages/product-client-portal-domain/entry.ts');
      const pkgClientPortalEntryIndex = path.join(__dirname, '../packages/product-client-portal-domain/entry.tsx');
      const pkgClientPortalEeEntry = path.join(__dirname, '../packages/product-client-portal-domain/ee/entry.tsx');
      config.resolve.alias[pkgClientPortalEntry] = pkgClientPortalEeEntry;
      config.resolve.alias[pkgClientPortalEntryIndex] = pkgClientPortalEeEntry;
    }

    logAliasSnapshot(config.resolve.alias);

    console.log('[next.config] aliases', {
      at: __dirname,
      '@': config.resolve.alias['@'],
      '@ee': config.resolve.alias['@ee'],
      'ee/server/src': config.resolve.alias['ee/server/src'],
      ceEmptyAbs: isEE ? path.join(__dirname, 'src', 'empty') : undefined,
      eeSrcAbs: isEE ? path.join(__dirname, '../ee/server/src') : undefined,
    });

    config.plugins = config.plugins || [];
    config.plugins.push(new LogModuleResolutionPlugin());
    config.plugins.push(new EditionBuildDiagnosticsPlugin());

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
    if (!isEE) {
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /(.*)(ee[\\\/]server[\\\/]src[\\\/]|@ee[\\\/])lib[\\\/]storage[\\\/]providers[\\\/]S3StorageProvider(\.[jt]s)?$/,
          path.join(__dirname, 'src/empty/lib/storage/providers/S3StorageProvider')
        )
      );
    }
    
    // In enterprise builds, remap any CE-stub absolute paths to their EE equivalents.
    // This ensures tsconfig path mapping that points to src/empty is overridden at webpack stage.
    if (isEE) {
      const ceEmptyPrefix = path.join(__dirname, 'src', 'empty') + path.sep;
      const ceEmptyRegex = new RegExp(ceEmptyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const eeSrcRoot = path.join(__dirname, '../ee/server/src') + path.sep;
      config.plugins = config.plugins || [];
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
        try {
          const req = resource.request || '';
          if (ceEmptyRegex.test(req)) {
            const rel = req.substring(ceEmptyPrefix.length);
            const mapped = path.join(eeSrcRoot, rel);
            if (process.env.LOG_MODULE_RESOLUTION === '1') {
              console.log('[replace:EE]', { from: req, to: mapped });
            }
            resource.request = mapped;
          }
        } catch {}
      }));
    }

  // Conditionally enable verbose resolution logging for EE/CE module paths
  if (process.env.LOG_MODULE_RESOLUTION === '1') {
      config.plugins = config.plugins || [];
      config.plugins.push(new LogModuleResolutionPlugin());

      // Also tap the resolver directly to capture final resolved paths
      class LogResolverPlugin {
        apply(compiler) {
          try {
            compiler.resolverFactory.hooks.resolver.for('normal').tap('LogResolverPlugin', (resolver) => {
              resolver.hooks.resolve.tapAsync('LogResolverPlugin', (request, ctx, done) => {
                try {
          const req = request.request || '';
          const normalizedRequest = stripLoaders(req);
          if (!shouldTraceRequest(req) && !shouldTraceRequest(normalizedRequest)) {
            return;
          }
          console.log('[resolver:resolve]', {
            request: req,
            normalizedRequest,
            path: request.path,
            context: request.context?.issuer || ctx.issuer,
          });
        } catch {}
        done();
      });
      resolver.hooks.result.tap('LogResolverPlugin', (result) => {
        try {
          if (!result) return;
          const resPath = result.path || '';
          const req = result.request || '';
          const normalizedRequest = stripLoaders(req);
          const hit = shouldTraceRequest(req) || shouldTraceRequest(normalizedRequest) || shouldTraceRequest(resPath);
          if (!hit) return;
          console.log('[resolver:result]', {
            request: req,
            normalizedRequest,
            resolvedPath: resPath,
            mappedTo: describeMappingTarget(resPath),
          });
        } catch {}
      });
            });
            console.log('[next.config] LogModuleResolutionPlugin enabled');
          } catch (e) {
            console.log('[next.config] Failed to enable LogResolverPlugin', e?.message);
          }
        }
      }
      config.plugins.push(new LogResolverPlugin());
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
