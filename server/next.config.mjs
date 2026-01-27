import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let webpack = null;
try {
  webpack = require('next/dist/compiled/webpack/webpack').webpack;
} catch (error) {
  console.warn('[next.config] Webpack runtime not available (likely running Turbopack dev server); skipping NormalModuleReplacementPlugin wiring.', error.message);
}

// Determine if this is an EE build
const isEE = process.env.EDITION === 'ee' || process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

// Reusable path to an empty shim for optional/native modules (used by Turbopack aliases)
const emptyShim = './src/empty/shims/empty.ts';

// ============================================================================
// SHARED ALIAS CONFIGURATION
// Define aliases once, use for both Turbopack (relative paths) and Webpack (absolute paths)
// ============================================================================

// Pre-built packages - point to /dist for compiled JS
const prebuiltPackageAliases = {
  '@alga-psa/auth': '../packages/auth/dist',
  '@alga-psa/ui': '../packages/ui/src',
  '@alga-psa/clients': '../packages/clients/dist',
  '@alga-psa/scheduling': '../packages/scheduling/dist',
  '@alga-psa/users': '../packages/users/dist',
  '@alga-psa/teams': '../packages/teams/dist',
  '@alga-psa/tags': '../packages/tags/dist',
  '@alga-psa/tenancy': '../packages/tenancy/dist',
  '@alga-psa/event-schemas': '../packages/event-schemas/dist',
  '@alga-psa/event-bus': '../packages/event-bus/dist',
  '@alga-psa/email': '../packages/email/dist',
  '@alga-psa/documents': '../packages/documents/dist',
  '@alga-psa/reference-data': '../packages/reference-data/dist',
  '@alga-psa/notifications': '../packages/notifications/dist',
  '@alga-psa/reporting': '../packages/reporting/dist',
  '@alga-psa/media': '../packages/media/dist',
  '@alga-psa/assets': '../packages/assets/dist',
  '@alga-psa/jobs': '../packages/jobs/dist',
  '@alga-psa/surveys': '../packages/surveys/dist',
  '@alga-psa/onboarding': '../packages/onboarding/dist',
  '@alga-psa/analytics': '../packages/analytics/dist',
  '@alga-psa/licensing': '../packages/licensing/dist',
  '@alga-psa/portal-shared': '../packages/portal-shared/dist',
  '@alga-psa/tickets': '../packages/tickets/dist',
  '@alga-psa/projects': '../packages/projects/dist',
  '@alga-psa/billing': '../packages/billing/dist',
  '@alga-psa/workflows': '../packages/workflows/dist',
  '@alga-psa/integrations': '../packages/integrations/dist',
  '@alga-psa/client-portal': '../packages/client-portal/dist',
};

// Runtime subpaths - point to /src for Next.js transpilation (actions, components, hooks)
const runtimeSubpathAliases = {
  // Clients
  '@alga-psa/clients/actions': '../packages/clients/src/actions',
  '@alga-psa/clients/components': '../packages/clients/src/components',
  '@alga-psa/clients/lib/billingHelpers': '../packages/clients/src/lib/billingHelpers.ts',
  '@alga-psa/clients/actions/contact-actions': '../packages/clients/src/actions/contact-actions',
  '@alga-psa/clients/actions/contact-actions/contactActions': '../packages/clients/src/actions/contact-actions/contactActions.tsx',
  '@alga-psa/clients/actions/contact-actions/contactNoteActions': '../packages/clients/src/actions/contact-actions/contactNoteActions.ts',
  // Scheduling
  '@alga-psa/scheduling/actions': '../packages/scheduling/src/actions',
  '@alga-psa/scheduling/components': '../packages/scheduling/src/components',
  '@alga-psa/scheduling/lib/contractLineDisambiguation': '../packages/scheduling/src/lib/contractLineDisambiguation.ts',
  '@alga-psa/scheduling/actions/appointmentHelpers': '../packages/scheduling/src/actions/appointmentHelpers.ts',
  '@alga-psa/scheduling/actions/appointmentRequestManagementActions': '../packages/scheduling/src/actions/appointmentRequestManagementActions.ts',
  '@alga-psa/scheduling/actions/availabilitySettingsActions': '../packages/scheduling/src/actions/availabilitySettingsActions.ts',
  '@alga-psa/scheduling/actions/scheduleActions': '../packages/scheduling/src/actions/scheduleActions.ts',
  '@alga-psa/scheduling/actions/serviceCatalogActions': '../packages/scheduling/src/actions/serviceCatalogActions.ts',
  '@alga-psa/scheduling/actions/timeEntryCrudActions': '../packages/scheduling/src/actions/timeEntryCrudActions.ts',
  '@alga-psa/scheduling/actions/timeEntryActions': '../packages/scheduling/src/actions/timeEntryActions.ts',
  '@alga-psa/scheduling/actions/timeEntryHelpers': '../packages/scheduling/src/actions/timeEntryHelpers.ts',
  '@alga-psa/scheduling/actions/timeEntrySchemas': '../packages/scheduling/src/actions/timeEntrySchemas.ts',
  '@alga-psa/scheduling/actions/timeEntryServices': '../packages/scheduling/src/actions/timeEntryServices.ts',
  '@alga-psa/scheduling/actions/timeEntryWorkItemActions': '../packages/scheduling/src/actions/timeEntryWorkItemActions.ts',
  '@alga-psa/scheduling/actions/timePeriodsActions': '../packages/scheduling/src/actions/timePeriodsActions.ts',
  '@alga-psa/scheduling/actions/timeSheetActions': '../packages/scheduling/src/actions/timeSheetActions.ts',
  '@alga-psa/scheduling/actions/timeSheetOperations': '../packages/scheduling/src/actions/timeSheetOperations.ts',
  '@alga-psa/scheduling/actions/workItemActions': '../packages/scheduling/src/actions/workItemActions.ts',
  '@alga-psa/scheduling/actions/time-period-settings-actions': '../packages/scheduling/src/actions/time-period-settings-actions',
  '@alga-psa/scheduling/actions/time-period-settings-actions/timePeriodSettingsActions': '../packages/scheduling/src/actions/time-period-settings-actions/timePeriodSettingsActions.ts',
  // Users
  '@alga-psa/users/actions': '../packages/users/src/actions',
  '@alga-psa/users/components': '../packages/users/src/components',
  '@alga-psa/users/services': '../packages/users/src/services',
  // Email
  '@alga-psa/email/actions': '../packages/email/src/actions',
  // Tickets
  '@alga-psa/tickets/actions': '../packages/tickets/src/actions',
  '@alga-psa/tickets/components': '../packages/tickets/src/components',
  '@alga-psa/tickets/actions/board-actions': '../packages/tickets/src/actions/board-actions',
  '@alga-psa/tickets/actions/board-actions/boardActions': '../packages/tickets/src/actions/board-actions/boardActions.ts',
  '@alga-psa/tickets/actions/comment-actions': '../packages/tickets/src/actions/comment-actions',
  '@alga-psa/tickets/actions/comment-actions/commentActions': '../packages/tickets/src/actions/comment-actions/commentActions.ts',
  '@alga-psa/tickets/actions/ticket-number-actions': '../packages/tickets/src/actions/ticket-number-actions',
  '@alga-psa/tickets/actions/ticket-number-actions/ticketNumberActions': '../packages/tickets/src/actions/ticket-number-actions/ticketNumberActions.ts',
  // Projects
  '@alga-psa/projects/actions': '../packages/projects/src/actions',
  '@alga-psa/projects/components': '../packages/projects/src/components',
  '@alga-psa/projects/actions/projectActions': '../packages/projects/src/actions/projectActions.ts',
  '@alga-psa/projects/actions/projectTaskActions': '../packages/projects/src/actions/projectTaskActions.ts',
  '@alga-psa/projects/actions/projectTaskCommentActions': '../packages/projects/src/actions/projectTaskCommentActions.ts',
  '@alga-psa/projects/actions/projectTaskStatusActions': '../packages/projects/src/actions/projectTaskStatusActions.ts',
  '@alga-psa/projects/actions/projectTemplateActions': '../packages/projects/src/actions/projectTemplateActions.ts',
  '@alga-psa/projects/actions/projectTemplateWizardActions': '../packages/projects/src/actions/projectTemplateWizardActions.ts',
  '@alga-psa/projects/actions/phaseTaskImportActions': '../packages/projects/src/actions/phaseTaskImportActions.ts',
  '@alga-psa/projects/actions/regenerateOrderKeys': '../packages/projects/src/actions/regenerateOrderKeys.ts',
  '@alga-psa/projects/actions/serviceCatalogActions': '../packages/projects/src/actions/serviceCatalogActions.ts',
  '@alga-psa/projects/lib/projectUtils': '../packages/projects/src/lib/projectUtils.ts',
  '@alga-psa/projects/lib/orderingService': '../packages/projects/src/lib/orderingService.ts',
  // Billing
  '@alga-psa/billing/actions': '../packages/billing/src/actions',
  '@alga-psa/billing/components': '../packages/billing/src/components',
  '@alga-psa/billing/models': '../packages/billing/src/models',
  '@alga-psa/billing/services': '../packages/billing/src/services',
  // Workflows
  '@alga-psa/workflows/actions': '../packages/workflows/src/actions',
  '@alga-psa/workflows/components': '../packages/workflows/src/components',
  '@alga-psa/workflows/hooks': '../packages/workflows/src/hooks',
  '@alga-psa/workflows/visualization/hooks': '../packages/workflows/src/visualization/hooks',
  '@alga-psa/workflows/visualization/services': '../packages/workflows/src/visualization/services',
  '@alga-psa/workflows/ee': '../packages/workflows/src/ee',
  '@alga-psa/workflows/oss': '../packages/workflows/src/oss',
  '@alga-psa/workflows/actions/workflow-actions': '../packages/workflows/src/actions/workflow-actions.ts',
  '@alga-psa/workflows/actions/workflow-actions/formRegistryActions': '../packages/workflows/src/actions/workflow-actions/formRegistryActions.ts',
  '@alga-psa/workflows/actions/workflow-actions/initializeWorkflows': '../packages/workflows/src/actions/workflow-actions/initializeWorkflows.ts',
  '@alga-psa/workflows/actions/workflow-actions/taskInboxActions': '../packages/workflows/src/actions/workflow-actions/taskInboxActions.ts',
  '@alga-psa/workflows/actions/workflow-actions/workflowActionRegistry': '../packages/workflows/src/actions/workflow-actions/workflowActionRegistry.ts',
  '@alga-psa/workflows/actions/activity-actions': '../packages/workflows/src/actions/activity-actions',
  '@alga-psa/workflows/actions/activity-actions/activityAggregationActions': '../packages/workflows/src/actions/activity-actions/activityAggregationActions.ts',
  '@alga-psa/workflows/actions/activity-actions/activityServerActions': '../packages/workflows/src/actions/activity-actions/activityServerActions.ts',
  '@alga-psa/workflows/actions/activity-actions/activityStatusActions': '../packages/workflows/src/actions/activity-actions/activityStatusActions.ts',
  '@alga-psa/workflows/actions/activity-actions/workflowTaskActions': '../packages/workflows/src/actions/activity-actions/workflowTaskActions.ts',
  '@alga-psa/workflows/actions/workflow-trigger-actions': '../packages/workflows/src/actions/workflow-trigger-actions.ts',
  '@alga-psa/workflows/actions/workflow-event-attachment-actions': '../packages/workflows/src/actions/workflow-event-attachment-actions.ts',
  '@alga-psa/workflows/actions/workflow-event-catalog-v2-actions': '../packages/workflows/src/actions/workflow-event-catalog-v2-actions.ts',
  '@alga-psa/workflows/actions/workflow-editor-actions': '../packages/workflows/src/actions/workflow-editor-actions.ts',
  '@alga-psa/workflows/actions/workflow-event-actions': '../packages/workflows/src/actions/workflow-event-actions.ts',
  '@alga-psa/workflows/actions/workflow-visualization-actions': '../packages/workflows/src/actions/workflow-visualization-actions.ts',
  '@alga-psa/workflows/actions/workflow-runtime-v2-actions': '../packages/workflows/src/actions/workflow-runtime-v2-actions.ts',
  '@alga-psa/workflows/actions/workflow-runtime-actions': '../packages/workflows/src/actions/workflow-runtime-actions.ts',
  '@alga-psa/workflows/actions/event-catalog-actions': '../packages/workflows/src/actions/event-catalog-actions.ts',
  '@alga-psa/workflows/actions/template-library-actions': '../packages/workflows/src/actions/template-library-actions.ts',
  // Tags
  '@alga-psa/tags/actions/tagActions': '../packages/tags/src/actions/tagActions.ts',
  // Notifications
  '@alga-psa/notifications/actions/notification-actions/notificationActions': '../packages/notifications/src/actions/notification-actions/notificationActions.ts',
  '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions': '../packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts',
  // Integrations
  '@alga-psa/integrations/actions': '../packages/integrations/src/actions',
  '@alga-psa/integrations/components': '../packages/integrations/src/components',
  '@alga-psa/integrations/lib': '../packages/integrations/src/lib',
  '@alga-psa/integrations/routes': '../packages/integrations/src/routes',
  '@alga-psa/integrations/webhooks': '../packages/integrations/src/webhooks',
  // Client-portal
  '@alga-psa/client-portal/actions': '../packages/client-portal/src/actions',
  '@alga-psa/client-portal/components': '../packages/client-portal/src/components',
};

// DB package aliases - keep pointing to source for HMR in dev
const dbPackageAliases = {
  '@alga-psa/db': '../packages/db/src/index.ts',
  '@alga-psa/db/admin': '../packages/db/src/lib/admin.ts',
  '@alga-psa/db/connection': '../packages/db/src/lib/connection.ts',
  '@alga-psa/db/tenant': '../packages/db/src/lib/tenant.ts',
  '@alga-psa/db/models': '../packages/db/src/models/index.ts',
  '@alga-psa/db/models/user': '../packages/db/src/models/user.ts',
  '@alga-psa/db/models/userPreferences': '../packages/db/src/models/userPreferences.ts',
  '@alga-psa/db/models/tenant': '../packages/db/src/models/tenant.ts',
  '@alga-psa/db/models/UserSession': '../packages/db/src/models/UserSession.ts',
};

// Shim aliases for unused/optional dependencies
const shimAliases = {
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
  // sharp optional packages
  '@img/sharp-libvips-dev/include': emptyShim,
  '@img/sharp-libvips-dev/cplusplus': emptyShim,
  '@img/sharp-wasm32/versions': emptyShim,
  // Knex dialect modules we don't use
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
};

// Edition-dependent aliases (CE vs EE)
const getEditionAliases = (isEE) => ({
  '@/empty': isEE ? '../ee/server/src' : './src/empty',
  '@/empty/': isEE ? '../ee/server/src/' : './src/empty/',
  './src/empty': isEE ? '../ee/server/src' : './src/empty',
  './src/empty/': isEE ? '../ee/server/src/' : './src/empty/',
  '@ee': isEE ? '../ee/server/src' : '../packages/ee/src',
  '@ee/': isEE ? '../ee/server/src/' : '../packages/ee/src/',
  'ee/server/src': isEE ? '../ee/server/src' : './src/empty',
  'ee/server/src/': isEE ? '../ee/server/src/' : './src/empty/',
});

// Product feature aliases (CE vs EE)
const getProductFeatureAliases = (isEE) => ({
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
  '@alga-psa/product-extension-initialization': isEE
    ? '../ee/server/src/lib/extensions/initialize'
    : '../packages/product-extension-initialization/oss/entry',
  '@alga-psa/product-extension-actions': isEE
    ? '../packages/product-extension-actions/ee/entry'
    : '../packages/product-extension-actions/oss/entry',
});

// Build combined aliases for Turbopack (relative paths)
const getTurbopackAliases = (isEE) => ({
  // Fix for emoji-mart data loading in Turbopack
  '@emoji-mart/data/sets/15/native.json': path.join(__dirname, '../node_modules/@emoji-mart/data/sets/15/native.json'),
  // Base app alias
  '@': './src',
  'server/src': './src',
  // Yjs ESM alignment
  'yjs': '../node_modules/yjs/dist/yjs.mjs',
  'yjs/dist/yjs.cjs': '../node_modules/yjs/dist/yjs.mjs',
  // Merge all alias groups
  ...prebuiltPackageAliases,
  ...runtimeSubpathAliases,
  ...dbPackageAliases,
  ...shimAliases,
  ...getEditionAliases(isEE),
  ...getProductFeatureAliases(isEE),
});

// Transform relative paths to absolute paths for Webpack
const toAbsolutePaths = (aliases, baseDir) => {
  const result = {};
  for (const [key, value] of Object.entries(aliases)) {
    if (typeof value === 'string' && value.startsWith('.')) {
      result[key] = path.join(baseDir, value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

// ============================================================================
// END SHARED ALIAS CONFIGURATION
// ============================================================================

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

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || appVersion,
  },
  turbopack: {
    root: path.resolve(__dirname, '..'),
    // Use shared alias configuration (relative paths for Turbopack)
    resolveAlias: getTurbopackAliases(isEE),
  },
  reactStrictMode: false, // Disabled to prevent double rendering in development
  // Only transpile external packages and runtime-only code
  // Pre-built @alga-psa/* packages are excluded - they're already compiled to JS in /dist
  transpilePackages: [
    // External packages that need transpiling
    '@blocknote/core',
    '@blocknote/react',
    '@blocknote/mantine',
    '@emoji-mart/data',
    // Product feature packages (runtime-only, not pre-built)
    '@product/extensions',
    '@product/settings-extensions',
    '@product/billing',
    '@product/chat',
    // Aliasing packages (runtime-only)
    '@alga-psa/product-extension-actions',
    '@alga-psa/product-auth-ee',
    '@alga-psa/product-extension-initialization',
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

    // Use shared alias configuration, transformed to absolute paths for Webpack
    const sharedAliases = toAbsolutePaths(getTurbopackAliases(isEE), __dirname);

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      ...sharedAliases,
      // Webpack-specific overrides for tsc-built packages (output to dist/packages/<name>/src)
      '@alga-psa/core': path.join(__dirname, '../dist/packages/core/src'),
      '@alga-psa/types': path.join(__dirname, '../dist/packages/types/src'),
      '@alga-psa/validation': path.join(__dirname, '../dist/packages/validation/src'),
      '@alga-psa/db': path.join(__dirname, '../dist/packages/db/src'),
      // Webpack-specific feature swap aliases (point to .tsx files for proper resolution)
      '@product/extensions/entry': isEE
        ? path.join(__dirname, '../packages/product-extensions/ee/entry.tsx')
        : path.join(__dirname, '../packages/product-extensions/oss/entry.tsx'),
      '@product/settings-extensions/entry': isEE
        ? path.join(__dirname, '../packages/product-settings-extensions/ee/entry.tsx')
        : path.join(__dirname, '../packages/product-settings-extensions/oss/entry.tsx'),
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
  },
  // Note: output: 'standalone' was removed due to static page generation issues
  generateBuildId: async () => {
    return 'build-' + Date.now();
  }
};

export default nextConfig;
