import { describe, expect, it } from 'vitest';

import { API_RULES, MSP_ROUTE_RULES, PORTAL_ROUTE_RULES } from '../../../lib/productSurfaceRegistry';
import {
  collectApiRoutes,
  collectMspPageRoutes,
  collectPortalPageRoutes,
  collectRoutes,
  listRouteDirSegments,
  matchesRules,
} from './support/appRouteInventory';

// Filesystem-driven inventory: every page under /msp must be explicitly
// ruled on in the route registry. The nav-anchored coherence suite
// (uiReachabilityCoherence.contract.test.ts) cannot see a page nobody
// linked; this one walks the app directory, so a brand-new page.tsx with
// neither a menu item nor a RouteRule fails here instead of silently
// riding the product fallback (psa: allowed, algadesk: not_found).
//
// Every entry is a REPORTED registry gap awaiting a product decision —
// the route rides the fallback today. Do not add entries without
// reporting the gap; remove entries as rules are added.
const KNOWN_UNRULED_ROUTES: Record<string, string> = {
  '/msp/chat': 'AI chat surface, no rule',
  '/msp/create-asset': 'quick-create page, no rule (sibling /msp/create-ticket IS ruled)',
  '/msp/create-client': 'quick-create page, no rule',
  '/msp/create-contact': 'quick-create page, no rule',
  '/msp/create-product': 'quick-create page, no rule',
  '/msp/create-project': 'quick-create page, no rule',
  '/msp/create-service': 'quick-create page, no rule',
  '/msp/document-templates': 'inventory-rail document layouts, no rule',
  '/msp/email-logs': 'System → Email Logs nav destination, no rule',
  '/msp/inventory': 'whole Inventory module rides the fallback',
  '/msp/invoices': 'invoice pages, no rule',
  '/msp/licenses': 'self-host License settings destination, no rule',
  '/msp/onboarding': 'onboarding wizard, no rule',
  '/msp/platform-updates': 'platform updates page, no rule',
  '/msp/quote-approvals': 'quote approval flow, no rule',
  '/msp/quote-document-templates': 'quote layout templates, no rule',
  '/msp/search': 'global search results page, no rule',
  '/msp/share_document': 'document share landing page, no rule',
  '/msp/workflows': 'workflow designer pages (EE); only /msp/workflow-editor and /msp/workflow-control are ruled',
};

describe('route registry filesystem inventory', () => {
  it('every /msp page on disk matches an explicit route rule or is a documented gap', () => {
    const routes = collectMspPageRoutes();
    expect(routes.size).toBeGreaterThan(20);

    const unruled = [...routes]
      .filter((route) => !matchesRules(MSP_ROUTE_RULES, route))
      .filter(
        (route) =>
          !Object.keys(KNOWN_UNRULED_ROUTES).some(
            (known) => route === known || route.startsWith(`${known}/`),
          ),
      )
      .sort();

    expect(
      unruled,
      `pages on disk with no explicit RouteRule — the product fallback silently decides who can reach them (psa: allowed, algadesk: not_found). Add a rule or document the gap: ${unruled.join(', ')}`,
    ).toEqual([]);
  });

  it('documented gaps stay honest: every KNOWN_UNRULED_ROUTES entry is still unruled and still has a page', () => {
    const routes = collectMspPageRoutes();

    for (const known of Object.keys(KNOWN_UNRULED_ROUTES)) {
      expect(
        matchesRules(MSP_ROUTE_RULES, known),
        `"${known}" now matches a route rule — remove it from KNOWN_UNRULED_ROUTES`,
      ).toBe(false);
      const stillExists = [...routes].some((route) => route === known || route.startsWith(`${known}/`));
      expect(
        stillExists,
        `"${known}" no longer has a page on disk — remove it from KNOWN_UNRULED_ROUTES`,
      ).toBe(true);
    }
  });

  // Client-portal pages riding the portal fallback (psa: allowed,
  // algadesk: not_found) — same reporting contract as KNOWN_UNRULED_ROUTES.
  const KNOWN_UNRULED_PORTAL_ROUTES: Record<string, string> = {
    '/client-portal/account':
      'REPORTED: same class as the fixed /msp/account gap — portal account page rides the fallback (algadesk portal users get not_found)',
    '/client-portal/licenses':
      'REPORTED: license surface rides the fallback; needs a portal rule decision',
  };

  it('every client-portal page on disk matches an explicit portal route rule or is a documented gap', () => {
    const routes = collectPortalPageRoutes();
    expect(routes.size).toBeGreaterThan(5);

    const unruled = [...routes]
      .filter((route) => !matchesRules(PORTAL_ROUTE_RULES, route))
      .filter(
        (route) =>
          !Object.keys(KNOWN_UNRULED_PORTAL_ROUTES).some(
            (known) => route === known || route.startsWith(`${known}/`),
          ),
      )
      .sort();
    expect(
      unruled,
      `client-portal pages with no explicit portal RouteRule — fallback decides reachability: ${unruled.join(', ')}`,
    ).toEqual([]);
  });

  // API route groups riding the API fallback. The fallback is fail-closed
  // for algadesk (denied) but fail-open for psa metadata visibility, and an
  // unclassified group means nobody decided the product boundary for it.
  // Grouped at /api/v1/<resource> (or /api/<area>) to keep the list humane.
  const KNOWN_UNRULED_API_GROUPS: Record<string, string> = {
    '/api/accounting': 'accounting export endpoints',
    '/api/auth': 'NextAuth handlers',
    '/api/billing': 'billing endpoints',
    '/api/calendar': 'calendar OAuth/sync',
    '/api/chat': 'AI chat completions',
    '/api/client-portal': 'portal session/domain endpoints',
    '/api/clients': 'client endpoints (non-v1)',
    '/api/documents': 'document endpoints (non-v1)',
    '/api/email': 'email endpoints outside ruled oauth/imap prefixes',
    '/api/ext': 'extension runtime',
    '/api/ext-bundles': 'extension bundles',
    '/api/ext-debug': 'extension debug',
    '/api/ext-proxy': 'extension proxy',
    '/api/ext-storage': 'extension storage',
    '/api/extensions': 'extension registry',
    '/api/files': 'file upload/download',
    '/api/health': 'health probe',
    '/api/healthz': 'health probe',
    '/api/import': 'CSV import',
    '/api/inbound': 'inbound email webhooks',
    '/api/installs': 'extension installs',
    '/api/integrations': 'integration endpoints',
    '/api/internal': 'internal service endpoints',
    '/api/inventory': 'inventory endpoints (non-v1)',
    '/api/mcp': 'MCP server',
    '/api/online-meetings': 'meeting integration',
    '/api/projects': 'project endpoints (non-v1)',
    '/api/provisioning': 'tenant provisioning',
    '/api/public': 'public unauthenticated endpoints',
    '/api/readyz': 'readiness probe',
    '/api/secrets': 'secrets management',
    '/api/share': 'share links',
    '/api/teams': 'MS Teams integration',
    '/api/tickets': 'ticket endpoints (non-v1)',
    '/api/v1/activities': 'v1 activities',
    '/api/v1/ai': 'v1 AI',
    '/api/v1/appliance-installs': 'v1 appliance installs',
    '/api/v1/auth': 'v1 auth',
    '/api/v1/billing-analytics': 'v1 billing analytics',
    '/api/v1/categories': 'v1 categories',
    '/api/v1/client-contract-lines': 'v1 contract lines',
    '/api/v1/company-contract-lines': 'v1 contract lines (legacy naming)',
    '/api/v1/contract-line-templates': 'v1 contract line templates',
    '/api/v1/feature-access': 'v1 feature access',
    '/api/v1/inbound-webhooks': 'v1 inbound webhooks',
    '/api/v1/mcp': 'v1 MCP',
    '/api/v1/mobile': 'v1 mobile app endpoints',
    '/api/v1/opportunities': 'v1 opportunities',
    '/api/v1/permission-checks': 'v1 permission checks',
    '/api/v1/permissions': 'v1 permissions',
    '/api/v1/platform-feature-flags': 'v1 platform flags',
    '/api/v1/platform-notifications': 'v1 platform notifications',
    '/api/v1/platform-reports': 'v1 platform reports',
    '/api/v1/quickbooks': 'v1 QuickBooks',
    '/api/v1/rbac': 'v1 RBAC',
    '/api/v1/roles': 'v1 roles',
    '/api/v1/schedules': 'v1 schedules',
    '/api/v1/search': 'v1 search',
    '/api/v1/software': 'v1 software',
    '/api/v1/storage': 'v1 storage',
    '/api/v1/tenant-management': 'v1 tenant management',
    '/api/v1/test-auth': 'v1 test auth',
    '/api/v1/time-periods': 'v1 time periods',
    '/api/v1/time-sheets': 'v1 time sheets',
    '/api/v1/user': 'v1 user',
    '/api/v1/user-roles': 'v1 user roles',
    '/api/v1/webhooks': 'v1 webhooks',
    '/api/webhooks': 'webhook receivers',
    '/api/workflow': 'workflow endpoints',
    '/api/workflow-definitions': 'workflow definitions',
    '/api/workflow-runs': 'workflow runs',
  };

  function apiGroupOf(route: string): string {
    const depth = route.startsWith('/api/v1/') ? 4 : 3;
    return route.split('/').slice(0, depth).join('/');
  }

  it('every API route group on disk matches an explicit API rule or is a documented gap', () => {
    const routes = collectApiRoutes();
    expect(routes.size).toBeGreaterThan(100);

    const unruledGroups = [
      ...new Set(
        [...routes].filter((route) => !matchesRules(API_RULES, route)).map(apiGroupOf),
      ),
    ]
      .filter((group) => !(group in KNOWN_UNRULED_API_GROUPS))
      .sort();
    expect(
      unruledGroups,
      `API route groups with no explicit ApiRule — the product boundary was never decided for them: ${unruledGroups.join(', ')}`,
    ).toEqual([]);
  });

  // Top-level app areas outside msp/client-portal/api are product-agnostic
  // by design (auth flows, share links, infra surfaces). New areas must be
  // classified here so they are a decision, not an accident.
  const PRODUCT_AGNOSTIC_AREAS: Record<string, string> = {
    '.well-known': 'well-known URIs (app deep links, security.txt)',
    auth: 'authentication flows for both portals, pre-product by nature',
    'ext-ui': 'extension iframe host surface',
    runner: 'extension runner surface',
    share: 'public tokened share-link landing pages',
    static: 'statically served asset routes',
    surveys: 'public tokened survey response pages',
    teams: 'Microsoft Teams app surface',
    'test-routing': 'dev-only routing test pages',
  };

  it('every top-level app area with routable files is msp, client-portal, api, or documented product-agnostic', () => {
    const covered = new Set(['msp', 'client-portal', 'api']);
    const appRoots = ['src/app', '../ee/server/src/app'];
    const offenders = [...listRouteDirSegments(appRoots)]
      .filter((area) => !covered.has(area) && !(area in PRODUCT_AGNOSTIC_AREAS))
      .filter((area) =>
        appRoots.some(
          (appRoot) =>
            collectRoutes([{ dir: `${appRoot}/${area}`, urlBase: `/${area}` }], 'any').size > 0,
        ),
      )
      .sort();
    expect(
      offenders,
      `top-level app areas with routable files that are neither product-ruled nor documented product-agnostic: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
