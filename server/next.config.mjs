import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
// build-trigger: update to force CI rebuild
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parsePositiveInt = (value) => {
  if (value == null) return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const truthyEnv = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

let webpack = null;
try {
  webpack = require('next/dist/compiled/webpack/webpack').webpack;
} catch (error) {
  console.warn('[next.config] Webpack runtime not available (likely running Turbopack dev server); skipping NormalModuleReplacementPlugin wiring.', error.message);
}

// Determine if this is an EE build
const isEE = process.env.EDITION === 'ee' || process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
console.log('[next.config] isEE:', isEE, { EDITION: process.env.EDITION, NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION });

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

const appVersion = (() => {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg?.version || 'dev';
  } catch {
    return 'dev';
  }
})();

const aliasEeEntryVariants = (aliasMap, pairs) => {
  pairs.forEach(({ fromCandidates = [], to }) => {
    fromCandidates
      .filter(Boolean)
      .forEach((candidate) => {
        aliasMap[candidate] = to;
      });
  });
};

// Optional verbose module resolution logging (enable with LOG_MODULE_RESOLUTION=1)
class LogModuleResolutionPlugin {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('LogModuleResolutionPlugin', (nmf) => {
      nmf.hooks.beforeResolve.tap('LogModuleResolutionPlugin', (data) => {
        try {
          if (!data) return;
          const req = data.request || '';
          if (process.env.LOG_MODULE_RESOLUTION === '1' && (req.startsWith('@ee') || req.includes('ee/server/src'))) {
            console.log('[resolve:before]', {
              request: req,
              issuer: data.contextInfo?.issuer,
              context: data.context,
            });
          }
        } catch {}
      });
      nmf.hooks.afterResolve.tap('LogModuleResolutionPlugin', (result) => {
        try {
          if (!result) return;
          const req = result.createData?.request || result.request || result.rawRequest || '';
          const res = result.resource || '';
          const hit = req.startsWith('@ee') || req.includes('ee/server/src') || res.includes('/ee/server/src/') || res.includes('/server/src/empty/');
          if (!hit || process.env.LOG_MODULE_RESOLUTION !== '1') return;
          const mappedTo = res.includes('/ee/server/src/') ? 'EE' : (res.includes('/server/src/empty/') ? 'CE-stub' : 'unknown');
          console.log('[resolve:after]', {
            request: req,
            resource: res,
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

const serverActionsBodyLimit = process.env.SERVER_ACTIONS_BODY_LIMIT || '20mb';
const buildCpus = parsePositiveInt(process.env.NEXT_BUILD_CPUS);
const memoryBasedWorkersCount = truthyEnv(process.env.NEXT_BUILD_MEMORY_BASED_WORKERS_COUNT);

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || appVersion,
    // Propagate edition to client-side code
    // When EDITION=ee, set NEXT_PUBLIC_EDITION=enterprise for client components
    NEXT_PUBLIC_EDITION: isEE ? 'enterprise' : (process.env.NEXT_PUBLIC_EDITION || 'community'),
  },
  turbopack: {
    root: path.resolve(__dirname, '..'),  // Point to the actual project root
    // Alias optional DB drivers we don't use to an empty shim for Turbopack
    resolveAlias: {
      // Fix for emoji-mart data loading in Turbopack
      '@emoji-mart/data/sets/15/native.json': path.join(__dirname, '../node_modules/@emoji-mart/data/sets/15/native.json'),
      // Base app alias
      '@': './src',
      'server/src': './src', // Add explicit alias for server/src imports
	      '@alga-psa/ui': '../packages/ui/src',
	      '@alga-psa/ui/': '../packages/ui/src/',
	      '@alga-psa/clients': '../packages/clients/src',
	      '@alga-psa/clients/': '../packages/clients/src/',
	      '@alga-psa/auth': '../packages/auth/src',
	      '@alga-psa/auth/': '../packages/auth/src/',
	      '@alga-psa/auth/getCurrentUser': '../packages/auth/src/lib/getCurrentUser.ts',
	      '@alga-psa/auth/session-bridge': '../packages/auth/src/lib/session-bridge.ts',
	      '@alga-psa/auth/withAuth': '../packages/auth/src/lib/withAuth.ts',
	      '@alga-psa/auth/nextAuthOptions': '../packages/auth/src/lib/nextAuthOptions.ts',
	      '@alga-psa/scheduling': '../packages/scheduling/src',
	      '@alga-psa/scheduling/': '../packages/scheduling/src/',
	      '@alga-psa/tags': '../packages/tags/src',
	      '@alga-psa/tags/': '../packages/tags/src/',
	      '@alga-psa/users': '../packages/users/src',
	      '@alga-psa/users/': '../packages/users/src/',
	      '@alga-psa/teams': '../packages/teams/src',
	      '@alga-psa/teams/': '../packages/teams/src/',
	      '@alga-psa/tenancy': '../packages/tenancy/src',
	      '@alga-psa/tenancy/': '../packages/tenancy/src/',
	      '@alga-psa/event-schemas': '../packages/event-schemas/src',
	      '@alga-psa/event-schemas/': '../packages/event-schemas/src/',
	      // Documents package
	      '@alga-psa/documents': '../packages/documents/src',
	      '@alga-psa/documents/': '../packages/documents/src/',
	      '@alga-psa/documents/storage/StorageService': '../packages/documents/src/storage/StorageService.ts',
	      // Reference data package
	      '@alga-psa/reference-data': '../packages/reference-data/src',
	      '@alga-psa/reference-data/': '../packages/reference-data/src/',
	      '@alga-psa/reference-data/actions': '../packages/reference-data/src/actions/index.ts',
	      '@alga-psa/reference-data/components': '../packages/reference-data/src/components/index.ts',
	      // Billing package
	      '@alga-psa/billing': '../packages/billing/src',
	      '@alga-psa/billing/': '../packages/billing/src/',
	      '@alga-psa/billing/actions': '../packages/billing/src/actions/index.ts',
	      '@alga-psa/billing/components': '../packages/billing/src/components/index.ts',
	      '@alga-psa/billing/models': '../packages/billing/src/models/index.ts',
	      '@alga-psa/billing/services': '../packages/billing/src/services/index.ts',
	      // Projects package
	      '@alga-psa/projects': '../packages/projects/src',
	      '@alga-psa/projects/': '../packages/projects/src/',
	      '@alga-psa/projects/actions': '../packages/projects/src/actions/index.ts',
	      '@alga-psa/projects/components': '../packages/projects/src/components/index.ts',
	      // DB package (use source files for Turbopack dev/HMR)
	      '@alga-psa/db': '../packages/db/src/index.ts',
	      '@alga-psa/db/admin': '../packages/db/src/lib/admin.ts',
	      '@alga-psa/db/connection': '../packages/db/src/lib/connection.ts',
	      '@alga-psa/db/tenant': '../packages/db/src/lib/tenant.ts',
	      '@alga-psa/db/models': '../packages/db/src/models/index.ts',
	      '@alga-psa/db/models/user': '../packages/db/src/models/user.ts',
	      '@alga-psa/db/models/userPreferences': '../packages/db/src/models/userPreferences.ts',
	      '@alga-psa/db/models/tenant': '../packages/db/src/models/tenant.ts',
	      '@alga-psa/db/models/UserSession': '../packages/db/src/models/UserSession.ts',
      '@/empty': isEE ? '../ee/server/src' : './src/empty',
      '@/empty/': isEE ? '../ee/server/src/' : './src/empty/',
      './src/empty': isEE ? '../ee/server/src' : './src/empty',
      './src/empty/': isEE ? '../ee/server/src/' : './src/empty/',
      '@ee': isEE ? '../ee/server/src' : '../packages/ee/src',
      '@ee/': isEE ? '../ee/server/src/' : '../packages/ee/src/',
      'ee/server/src': isEE ? '../ee/server/src' : './src/empty',
      'ee/server/src/': isEE ? '../ee/server/src/' : './src/empty/',
      // Native DB drivers not used
      'better-sqlite3': emptyShim,
      'sqlite3': emptyShim,
      'mysql': emptyShim,
      'mysql2': emptyShim,
      'oracledb': emptyShim,
      'tedious': emptyShim,
      // Node.js-only modules that shouldn't be bundled for client
      'node-vault': emptyShim,
      'postman-request': emptyShim,
      // Optional ffmpeg dependencies
      'ffmpeg-static': emptyShim,
      'ffprobe-static': emptyShim,
      'ffprobe-static/package.json': './src/empty/shims/ffprobe-package.json',
      'ffmpeg-static/package.json': './src/empty/shims/ffprobe-package.json',
      // sharp tries to conditionally require these optional packages; webpack can't statically resolve them
      '@img/sharp-libvips-dev/include': emptyShim,
      '@img/sharp-libvips-dev/cplusplus': emptyShim,
      '@img/sharp-wasm32/versions': emptyShim,
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

      // Ensure Yjs resolves to a single ESM entrypoint to avoid "Yjs was already imported" warnings
      // caused by mixing CJS + ESM Yjs bundles in the same runtime.
      'yjs': '../node_modules/yjs/dist/yjs.mjs',
      'yjs/dist/yjs.cjs': '../node_modules/yjs/dist/yjs.mjs',

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
      '@product/ext-proxy/handler': isEE
        ? '@product/ext-proxy/ee/handler'
        : '@product/ext-proxy/oss/handler',
      '@alga-psa/integrations/email/providers/entry': isEE
        ? '@alga-psa/integrations/email/providers/ee/entry'
        : '@alga-psa/integrations/email/providers/oss/entry',
      '@alga-psa/integrations/email/settings/entry': isEE
        ? '@alga-psa/integrations/email/settings/ee/entry'
        : '@alga-psa/integrations/email/settings/oss/entry',
      '@alga-psa/integrations/email/domains/entry': isEE
        ? '@alga-psa/integrations/email/domains/ee/entry'
        : '@alga-psa/integrations/email/domains/oss/entry',
      '@alga-psa/client-portal/domain-settings/entry': isEE
        ? '@alga-psa/client-portal/domain-settings/ee/entry'
        : '@alga-psa/client-portal/domain-settings/oss/entry',
      '@alga-psa/workflows/entry': isEE
        ? '../packages/workflows/src/ee/entry'
        : '../packages/workflows/src/oss/entry',
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
  reactStrictMode: false, // Disabled to prevent double rendering in development
	  transpilePackages: [
	    '@blocknote/core',
	    '@blocknote/react',
	    '@blocknote/mantine',
	    '@emoji-mart/data',
	    '@alga-psa/core',
	    '@alga-psa/auth',
	    '@alga-psa/tags',
	    '@alga-psa/ui',
	    '@alga-psa/clients',
	    '@alga-psa/scheduling',
	    '@alga-psa/users',
	    '@alga-psa/teams',
	    '@alga-psa/tenancy',
	    '@alga-psa/integrations',
	    '@alga-psa/client-portal',
	    '@alga-psa/event-schemas',
	    '@alga-psa/documents',
	    '@alga-psa/reference-data',
	    '@alga-psa/billing',
	    '@alga-psa/projects',
	    // Product feature packages (only those needed in this app)
	    '@product/extensions',
    '@product/settings-extensions',
    '@product/billing',
    '@alga-psa/workflows',
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
    const isEE = process.env.EDITION === 'ee' || process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    console.log('[next.config] edition', isEE ? 'enterprise' : 'community', {
      cwd: process.cwd(),
      dirname: __dirname,
      LOG_MODULE_RESOLUTION: process.env.LOG_MODULE_RESOLUTION,
    });

    config.resolve ??= {};

    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.jsx': ['.tsx', '.jsx'],
    };

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@': path.join(__dirname, 'src'),
      'server/src': path.join(__dirname, 'src'), // Add explicit alias for server/src imports
      // sharp tries to conditionally require these optional packages; webpack can't statically resolve them
      '@img/sharp-libvips-dev/include': path.join(__dirname, 'src/empty/shims/empty.ts'),
      '@img/sharp-libvips-dev/cplusplus': path.join(__dirname, 'src/empty/shims/empty.ts'),
      '@img/sharp-wasm32/versions': path.join(__dirname, 'src/empty/shims/empty.ts'),
      '@alga-psa/auth': path.join(__dirname, '../packages/auth/src'),
      '@alga-psa/ui': path.join(__dirname, '../packages/ui/src'),
      '@alga-psa/clients': path.join(__dirname, '../packages/clients/src'),
      '@alga-psa/scheduling': path.join(__dirname, '../packages/scheduling/src'),
      '@alga-psa/users': path.join(__dirname, '../packages/users/src'),
      '@alga-psa/teams': path.join(__dirname, '../packages/teams/src'),
      '@alga-psa/event-schemas': path.join(__dirname, '../packages/event-schemas/src'),
      '@ee': isEE
        ? path.join(__dirname, '../ee/server/src')
        : path.join(__dirname, '../packages/ee/src'), // Point to CE stub implementations
      // Also map deep EE paths used without the @ee alias to CE stubs
      // This ensures CE builds don't fail when code references ee/server/src directly
      'ee/server/src': isEE
        ? path.join(__dirname, '../ee/server/src')
        : path.join(__dirname, 'src/empty'),

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
      '@alga-psa/integrations/email/providers/entry': isEE
        ? path.join(__dirname, '../packages/integrations/src/email/providers/ee/entry.tsx')
        : path.join(__dirname, '../packages/integrations/src/email/providers/oss/entry.tsx'),
      '@alga-psa/integrations/email/settings/entry': isEE
        ? path.join(__dirname, '../packages/integrations/src/email/settings/ee/entry.tsx')
        : path.join(__dirname, '../packages/integrations/src/email/settings/oss/entry.tsx'),
      '@alga-psa/integrations/email/domains/entry': isEE
        ? path.join(__dirname, '../packages/integrations/src/email/domains/ee/entry.ts')
        : path.join(__dirname, '../packages/integrations/src/email/domains/oss/entry.ts'),
      '@alga-psa/client-portal/domain-settings/entry': isEE
        ? path.join(__dirname, '../packages/client-portal/src/domain-settings/ee/entry.tsx')
        : path.join(__dirname, '../packages/client-portal/src/domain-settings/oss/entry.tsx'),
      '@alga-psa/workflows/entry': isEE
        ? path.join(__dirname, '../packages/workflows/src/ee/entry.tsx')
        : path.join(__dirname, '../packages/workflows/src/oss/entry.tsx'),
      '@product/billing/entry': isEE
        ? path.join(__dirname, '../packages/product-billing/ee/entry.tsx')
        : path.join(__dirname, '../packages/product-billing/oss/entry.tsx'),
      // Point stable specifiers to exact entry files to avoid conditional exports in package index
      '@alga-psa/product-extension-initialization': isEE
        ? path.join(__dirname, '../ee/server/src/lib/extensions/initialize.ts')
        : path.join(__dirname, '../packages/product-extension-initialization/oss/entry.ts'),
      '@alga-psa/product-extension-actions': isEE
        ? path.join(__dirname, '../packages/product-extension-actions/ee/entry.ts')
        : path.join(__dirname, '../packages/product-extension-actions/oss/entry.ts'),
      '@alga-psa/product-auth-ee': path.join(__dirname, '../packages/product-auth-ee'),
    };

    const resolveModules = config.resolve.modules ?? ['node_modules'];
    config.resolve.modules = [...resolveModules, path.join(__dirname, '../node_modules')];

    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      querystring: require.resolve('querystring-es3'),
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

      const pkgClientPortalEntry = path.join(__dirname, '../packages/client-portal/src/domain-settings/entry.ts');
      const pkgClientPortalEntryIndex = path.join(__dirname, '../packages/client-portal/src/domain-settings/entry.tsx');
      const pkgClientPortalEeEntry = path.join(__dirname, '../packages/client-portal/src/domain-settings/ee/entry.tsx');
      config.resolve.alias[pkgClientPortalEntry] = pkgClientPortalEeEntry;
      config.resolve.alias[pkgClientPortalEntryIndex] = pkgClientPortalEeEntry;

      const pkgEmailDomainsEntry = path.join(__dirname, '../packages/integrations/src/email/domains/entry.ts');
      const pkgEmailDomainsEeEntry = path.join(__dirname, '../packages/integrations/src/email/domains/ee/entry.ts');
      config.resolve.alias[pkgEmailDomainsEntry] = pkgEmailDomainsEeEntry;

      aliasEeEntryVariants(config.resolve.alias, [
        {
          to: pkgExtensionsEeEntry,
          fromCandidates: [
            path.join(__dirname, '../packages/product-extensions/oss/entry.ts'),
            path.join(__dirname, '../packages/product-extensions/oss/entry.tsx'),
          ],
        },
        {
          to: pkgSettingsEeEntry,
          fromCandidates: [
            path.join(__dirname, '../packages/product-settings-extensions/oss/entry.ts'),
            path.join(__dirname, '../packages/product-settings-extensions/oss/entry.tsx'),
          ],
        },
        {
          to: pkgClientPortalEeEntry,
          fromCandidates: [
            path.join(__dirname, '../packages/client-portal/src/domain-settings/oss/entry.ts'),
            path.join(__dirname, '../packages/client-portal/src/domain-settings/oss/entry.tsx'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/integrations/src/email/providers/ee/entry.tsx'),
          fromCandidates: [
            path.join(__dirname, '../packages/integrations/src/email/providers/entry.ts'),
            path.join(__dirname, '../packages/integrations/src/email/providers/oss/entry.ts'),
            path.join(__dirname, '../packages/integrations/src/email/providers/oss/entry.tsx'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/integrations/src/email/settings/ee/entry.tsx'),
          fromCandidates: [
            path.join(__dirname, '../packages/integrations/src/email/settings/entry.ts'),
            path.join(__dirname, '../packages/integrations/src/email/settings/oss/entry.ts'),
            path.join(__dirname, '../packages/integrations/src/email/settings/oss/entry.tsx'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/integrations/src/email/domains/ee/entry.ts'),
          fromCandidates: [
            path.join(__dirname, '../packages/integrations/src/email/domains/entry.ts'),
            path.join(__dirname, '../packages/integrations/src/email/domains/oss/entry.ts'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/product-billing/ee/entry.tsx'),
          fromCandidates: [
            path.join(__dirname, '../packages/product-billing/entry.ts'),
            path.join(__dirname, '../packages/product-billing/entry.tsx'),
            path.join(__dirname, '../packages/product-billing/oss/entry.ts'),
            path.join(__dirname, '../packages/product-billing/oss/entry.tsx'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/product-chat/ee/entry.tsx'),
          fromCandidates: [
            path.join(__dirname, '../packages/product-chat/entry.ts'),
            path.join(__dirname, '../packages/product-chat/entry.tsx'),
            path.join(__dirname, '../packages/product-chat/oss/entry.ts'),
            path.join(__dirname, '../packages/product-chat/oss/entry.tsx'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/product-extension-actions/ee/entry.ts'),
          fromCandidates: [
            path.join(__dirname, '../packages/product-extension-actions/entry.ts'),
            path.join(__dirname, '../packages/product-extension-actions/oss/entry.ts'),
          ],
        },
        {
          to: path.join(__dirname, '../packages/product-extension-initialization/ee/entry.ts'),
          fromCandidates: [
            path.join(__dirname, '../packages/product-extension-initialization/entry.ts'),
            path.join(__dirname, '../packages/product-extension-initialization/oss/entry.ts'),
          ],
        },
      ]);
    }

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

    // Externalize optional ffmpeg dependencies
    // These are optional runtime dependencies that may not be installed
    config.externals.push('ffmpeg-static');
    config.externals.push('ffprobe-static');

    // Externalize sharp for server builds to avoid bundling native dependencies.
    // sharp (and its optional @img/* helpers) should be resolved at runtime by Node.
    if (isServer) {
      config.externals.push('sharp');
    } else if (webpack) {
      // For client builds, make sure any accidental sharp import is replaced with an empty shim.
      config.resolve.alias = {
        ...config.resolve.alias,
        sharp: emptyShim,
      };
    }

    // sharp conditionally requires these optional packages; webpack can't statically resolve them
    // and we don't want missing-module failures during compilation.
    if (webpack) {
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^@img\/sharp-libvips-dev\/(include|cplusplus)$/ })
      );
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^@img\/sharp-wasm32\/versions$/ })
      );
    }

    // Replace Node.js-only modules with empty shims for client builds
    // These modules use Node.js built-ins like 'tls', 'net', etc. that don't exist in the browser
    if (!isServer && webpack) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'node-vault': emptyShim,
        'postman-request': emptyShim,
      };
    }

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
      if (!webpack) {
        console.warn('[next.config] Skipping CE S3 storage provider replacement because webpack is unavailable in the current runtime.');
      } else {
        config.plugins = config.plugins || [];
        config.plugins.push(
          new webpack.NormalModuleReplacementPlugin(
            // Removed (.*) prefix - was causing catastrophic backtracking on large strings
            /(ee[\\\/]server[\\\/]src[\\\/]|@ee[\\\/])lib[\\\/]storage[\\\/]providers[\\\/]S3StorageProvider(\.[jt]s)?$/,
            path.join(__dirname, 'src/empty/lib/storage/providers/S3StorageProvider')
          )
        );
      }
    }
    
	    // In enterprise builds, remap any CE-stub absolute paths to their EE equivalents.
	    // This ensures tsconfig path mapping that points to src/empty is overridden at webpack stage.
	    if (isEE) {
	      if (!webpack) {
	        console.warn('[next.config] Skipping EE empty-stub replacement plugin because webpack is unavailable in the current runtime.');
	      } else {
	        const ceEmptyPrefix = path.join(__dirname, 'src', 'empty') + path.sep;
	        const ceEmptyRegex = new RegExp(ceEmptyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	        // Also handle packages/ee/src CE stubs (used by workspace package dynamic imports)
	        const cePackagesEePrefix = path.join(__dirname, '../packages/ee/src') + path.sep;
	        const cePackagesEeRegex = new RegExp(cePackagesEePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	        const eeSrcRoot = path.join(__dirname, '../ee/server/src') + path.sep;
	        const workflowsEeEntry = path.join(__dirname, '../packages/workflows/src/ee/entry.tsx');
	        config.plugins = config.plugins || [];
	        config.plugins.push(new webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
	          try {
	            const req = resource.request || '';
	            // Next.js adds a JsConfigPathsPlugin based on tsconfig "paths".
	            // Our tsconfig maps `@alga-psa/workflows/entry -> packages/workflows/src/entry` (OSS stub) and relies on webpack
	            // aliasing to override to the EE entry in enterprise builds. In practice, JsConfigPathsPlugin can resolve the OSS
	            // path first when that file exists, producing "hybrid" EE builds where workflows still load the OSS EE-only stub UI.
	            //
	            // Force consistency by rewriting the workflows entry specifier to the EE source file *before* resolution.
	            if (req === '@alga-psa/workflows/entry') {
	              resource.request = workflowsEeEntry;
	              return;
	            }
	            // IMPORTANT:
	            // Next.js adds a JsConfigPathsPlugin based on tsconfig "paths".
	            // Our tsconfig maps `@ee/* -> packages/ee/src/*` (CE stubs) and relies on webpack to override
	            // to `ee/server/src` in EE builds.
	            //
	            // In practice, JsConfigPathsPlugin can resolve the stub path first when the stub file exists,
	            // producing "hybrid" EE builds where some `@ee/*` imports fall back to real EE code (when no
	            // stub exists), but many resolve to CE stubs (when the stub does exist).
	            //
	            // To force consistency, rewrite `@ee/*` specifiers to the EE source root *before* resolution.
	            if (req === '@ee') {
	              resource.request = eeSrcRoot.slice(0, -path.sep.length);
	              return;
	            }
	            if (req.startsWith('@ee/')) {
	              const rel = req.substring('@ee/'.length);
	              const mapped = path.join(eeSrcRoot, rel);
	              if (process.env.LOG_MODULE_RESOLUTION === '1') {
	                console.log('[replace:EE:@ee]', { from: req, to: mapped });
	              }
	              resource.request = mapped;
	              return;
	            }
	            // Replace src/empty paths
	            if (ceEmptyRegex.test(req)) {
	              const rel = req.substring(ceEmptyPrefix.length);
	              const mapped = path.join(eeSrcRoot, rel);
	              if (process.env.LOG_MODULE_RESOLUTION === '1') {
                console.log('[replace:EE:empty]', { from: req, to: mapped });
              }
              resource.request = mapped;
            }
            // Replace packages/ee/src paths (CE stubs from workspace packages)
            else if (cePackagesEeRegex.test(req)) {
              const rel = req.substring(cePackagesEePrefix.length);
              const mapped = path.join(eeSrcRoot, rel);
              if (process.env.LOG_MODULE_RESOLUTION === '1') {
                console.log('[replace:EE:packages]', { from: req, to: mapped });
              }
	              resource.request = mapped;
	            }
	          } catch {}
	        }));
	      }
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
                  if (req.startsWith('@ee') || req.includes('ee/server/src')) {
                    console.log('[resolver:resolve]', {
                      request: req,
                      path: request.path,
                      context: request.context?.issuer || ctx.issuer,
                    });
                  }
                } catch {}
                done();
              });
              resolver.hooks.result.tap('LogResolverPlugin', (result) => {
                try {
                  if (!result) return;
                  const resPath = result.path || '';
                  const req = result.request || '';
                  const hit = req?.startsWith?.('@ee') || req?.includes?.('ee/server/src') || resPath.includes('/ee/server/src/') || resPath.includes('/server/src/empty/');
                  if (!hit) return;
                  console.log('[resolver:result]', {
                    request: req,
                    resolvedPath: resPath,
                    mappedTo: resPath.includes('/ee/server/src/') ? 'EE' : (resPath.includes('/server/src/empty/') ? 'CE-stub' : 'unknown'),
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
      bodySizeLimit: serverActionsBodyLimit,
    },
    // Increase middleware body size limit for extension installs
    proxyClientMaxBodySize: '100mb',
    // Next build "Collecting page data" uses a worker pool sized from this value.
    // In large repos, the default (often == host CPU count) can cause OOMs in CI.
    ...(buildCpus ? { cpus: buildCpus } : {}),
    ...(memoryBasedWorkersCount ? { memoryBasedWorkersCount: true } : {}),
  },
  // Externalize Node.js-only packages with native dependencies from server bundles.
  // This prevents Turbopack from bundling them with mangled names.
  serverExternalPackages: ['puppeteer', 'sharp'],
  // Note: output: 'standalone' was removed due to static page generation issues
  generateBuildId: async () => {
    return 'build-' + Date.now();
  }
};

export default nextConfig;
