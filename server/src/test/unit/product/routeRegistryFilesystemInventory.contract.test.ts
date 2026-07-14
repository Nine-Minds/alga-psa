import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  MSP_ROUTE_RULES,
  matchesDynamicPattern,
  matchesStaticPrefix,
} from '../../../lib/productSurfaceRegistry';

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
  '/msp/account-manager': 'account-manager workspace, no rule',
  '/msp/automation-hub': 'automation hub, no rule',
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

const APP_ROOTS = [
  { dir: 'src/app/msp', urlBase: '/msp' },
  { dir: '../ee/server/src/app/msp', urlBase: '/msp' },
];

function collectPageRoutes(absDir: string, urlSegments: string[], out: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const name = entry.name;
      if (name.startsWith('@') || name.startsWith('_')) continue;
      const nextSegments =
        name.startsWith('(') && name.endsWith(')')
          ? urlSegments
          : [...urlSegments, name.startsWith('[') ? 'dynamic-segment' : name];
      collectPageRoutes(path.join(absDir, name), nextSegments, out);
    } else if (/^page\.(t|j)sx?$/.test(entry.name)) {
      out.add(`/${urlSegments.join('/')}`);
    }
  }
}

function matchesAnyRule(pathname: string): boolean {
  return MSP_ROUTE_RULES.some(
    (rule) =>
      (rule.staticPrefixes && matchesStaticPrefix(pathname, rule.staticPrefixes)) ||
      (rule.dynamicPatterns && matchesDynamicPattern(pathname, rule.dynamicPatterns)),
  );
}

describe('route registry filesystem inventory', () => {
  it('every /msp page on disk matches an explicit route rule or is a documented gap', () => {
    const routes = new Set<string>();
    for (const root of APP_ROOTS) {
      collectPageRoutes(path.resolve(process.cwd(), root.dir), root.urlBase.slice(1).split('/'), routes);
    }
    expect(routes.size).toBeGreaterThan(20);

    const unruled = [...routes]
      .filter((route) => !matchesAnyRule(route))
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
    const routes = new Set<string>();
    for (const root of APP_ROOTS) {
      collectPageRoutes(path.resolve(process.cwd(), root.dir), root.urlBase.slice(1).split('/'), routes);
    }

    for (const known of Object.keys(KNOWN_UNRULED_ROUTES)) {
      expect(
        matchesAnyRule(known),
        `"${known}" now matches a route rule — remove it from KNOWN_UNRULED_ROUTES`,
      ).toBe(false);
      const stillExists = [...routes].some((route) => route === known || route.startsWith(`${known}/`));
      expect(
        stillExists,
        `"${known}" no longer has a page on disk — remove it from KNOWN_UNRULED_ROUTES`,
      ).toBe(true);
    }
  });
});
