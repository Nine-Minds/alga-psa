import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  navigationSections,
  bottomMenuItems,
  settingsNavigationSections,
  type MenuItem,
  type NavigationSection,
} from '../../../config/menuConfig';
import {
  MSP_ROUTE_RULES,
  filterMenuSectionsByProduct,
  resolveProductRouteBehavior,
} from '../../../lib/productSurfaceRegistry';
import { getAllowedSettingsTabIds } from '../../../lib/settingsProductTabs';
import { listRouteDirSegments, matchesRules } from './support/appRouteInventory';

type ProductCode = 'algadesk' | 'psa';
const PRODUCTS: ProductCode[] = ['algadesk', 'psa'];

// Pages that are reachable but intentionally carry no sidebar/settings-rail
// entry. Every entry states how the page IS reached; a prefix listed here
// without a real entry point is a product bug.
const INTENTIONALLY_UNLINKED: Record<string, string> = {
  '/msp/account': 'reached via the header avatar menu → Account, not the sidebar',
  '/msp/add-ons': 'reached via add-on notices and paywall CTAs, not the sidebar',
  '/msp/co-managed': 'capability-gated Co-managed IT menu group contributed through the msp.navigation.group UI slot (config/coManagedMenu.ts), not menuConfig; coManagedMenuGroup.test.tsx pins it',
  '/msp/co-management/administration': 'capability-gated Access & administration screen; the sidebar shows it only when the co-managed capability holds (SidebarWithFeatureFlags filters it out otherwise), so the registry-level coherence check does not see it',
  '/msp/co-management/customer-tickets': 'capability-gated (co-managed serves) sponsor queue of customer-shared tickets, reached by its own deep links; the nav entry arrives when the L1b Oversight shell absorbs this route',
  '/msp/co-management/tasks': 'capability-gated (co-managed serves) sponsor Shared Tasks queue, reached from the Projects page via CoManagedProjectTaskQueueLink',
  '/msp/co-management/projects': 'capability-gated (co-managed serves) shared project screen, reached by deep links from the Shared Tasks queue and shared search results',
  '/msp/co-management/providers': 'capability-gated provider setup reached through the product-neutral /msp/go/providers entry (Open Providers in email setup, profile SSO)',
  '/msp/create-opportunity': 'reached via the Quick Create button in the header, not the sidebar',
  '/msp/create-ticket': 'reached via the Quick Create button in the header, not the sidebar',
  '/msp/integrations': 'legacy path kept routable; the user-facing entry is /msp/settings/integrations',
  '/msp/test': 'internal test-only pages, deliberately unlinked from all navigation',
};

// Nav destinations the route registry does not explicitly rule on today.
// They ride the product fallback (psa: allowed, algadesk: not_found), which
// silently hides them from AlgaDesk nav instead of taking a position.
// Each entry is a REPORTED registry gap awaiting a product fix — do not add
// entries without reporting the gap.
const KNOWN_REGISTRY_GAPS: Record<string, string> = {
  '/msp/inventory': 'no RouteRule; algadesk hides the whole Inventory nav item via fallback',
  '/msp/email-logs': 'no RouteRule; algadesk hides System → Email Logs via fallback',
  '/msp/licenses': 'no RouteRule; algadesk hides the self-host License settings entry via fallback',
};

// Known (permission → UI entry) couplings. The UI hides the entry when the
// permission is missing, so the permission must exist in every product's
// seed vocabulary or the page is silently unreachable for that product.
const PERMISSION_NAV_PINS: Array<{
  permission: string;
  action: string;
  destination: string;
  reachedVia: string;
  wiringFile: string;
  wiringMarker: string;
}> = [
  {
    permission: 'account_management',
    action: 'read',
    destination: '/msp/account',
    reachedVia: 'header avatar menu → Account',
    wiringFile: 'src/components/layout/Header.tsx',
    wiringMarker: 'checkAccountManagementPermission(',
  },
];

const allSidebarSections: NavigationSection[] = [
  ...navigationSections,
  ...settingsNavigationSections,
  { title: 'Bottom', items: bottomMenuItems },
];

function collectHrefs(items: MenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...(item.subItems ? collectHrefs(item.subItems) : []),
  ]);
}

function survivingHrefs(product: ProductCode): string[] {
  return filterMenuSectionsByProduct(product, allSidebarSections)
    .flatMap((section) => collectHrefs(section.items))
    .filter((href) => !href.startsWith('http'));
}

function stripQuery(href: string): string {
  return href.split('?')[0];
}

function settingsTabOf(href: string): string | null {
  const [base, query] = href.split('?');
  if (base !== '/msp/settings' || !query) return null;
  return new URLSearchParams(query).get('tab');
}

// Both products provision from the unified permission catalog.
const permissionCatalog = createRequire(import.meta.url)(
  path.resolve(process.cwd(), '../server/migrations/utils/permissions/catalog.cjs'),
);

function seedGrantsPermission(product: ProductCode, resource: string, action: string): boolean {
  return permissionCatalog
    .getProductPermissions(product)
    .some((entry: { resource: string; action: string }) =>
      entry.resource === resource && entry.action === action);
}

describe('UI reachability coherence (nav ↔ route ↔ permission)', () => {
  it('no dead links: every nav href that survives the product filter resolves to an allowed route', () => {
    for (const product of PRODUCTS) {
      for (const href of survivingHrefs(product)) {
        const pathname = stripQuery(href);
        expect(
          resolveProductRouteBehavior(product, pathname),
          `${product}: nav href "${href}" survives filterMenuSectionsByProduct but "${pathname}" does not resolve to an allowed route`,
        ).toBe('allowed');
      }
    }
  });

  it('every nav destination matches an explicit route rule — fallback behavior must not decide reachability', () => {
    const rawHrefs = allSidebarSections
      .flatMap((section) => collectHrefs(section.items))
      .filter((href) => href.startsWith('/msp/'));

    const unregistered = [...new Set(rawHrefs.map(stripQuery))]
      .filter((pathname) => !(pathname in KNOWN_REGISTRY_GAPS))
      .filter((pathname) => !matchesRules(MSP_ROUTE_RULES, pathname));

    expect(
      unregistered,
      `nav destinations with no explicit RouteRule (product fallback decides their reachability, which is how pages silently disappear): ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('no orphan discoverable pages: every route prefix the registry allows has a nav entry point or a documented alternative', () => {
    for (const product of PRODUCTS) {
      const covered = new Set<string>();
      for (const href of survivingHrefs(product)) {
        covered.add(stripQuery(href));
        const tab = settingsTabOf(href);
        if (tab) covered.add(`/msp/settings/${tab}`);
      }

      const allowedPrefixes = MSP_ROUTE_RULES.flatMap((rule) =>
        rule.behaviorByProduct[product] === 'allowed' ? [...(rule.staticPrefixes ?? [])] : [],
      );

      const orphans = allowedPrefixes
        .filter((prefix) => !(prefix in INTENTIONALLY_UNLINKED))
        .filter(
          (prefix) =>
            ![...covered].some(
              (href) => href === prefix || href.startsWith(`${prefix}/`) || prefix.startsWith(`${href}/`),
            ),
        );
      expect(
        orphans,
        `${product}: route prefixes allowed by the registry with no surviving nav/menu entry point — add the entry point or document how the page is reached in INTENTIONALLY_UNLINKED: ${orphans.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('permission vocabulary covers permission-gated nav entries for every product', () => {
    for (const pin of PERMISSION_NAV_PINS) {
      const wiringSource = fs.readFileSync(path.resolve(process.cwd(), pin.wiringFile), 'utf8');
      expect(
        wiringSource,
        `expected ${pin.wiringFile} to gate the entry via ${pin.wiringMarker} (${pin.reachedVia}) — if the gate moved, update this pin`,
      ).toContain(pin.wiringMarker);

      const missing = PRODUCTS.filter(
        (product) => !seedGrantsPermission(product, pin.permission, pin.action),
      );
      expect(
        missing,
        `permission catalog missing ${pin.permission}:${pin.action} — "${pin.reachedVia}" is silently unreachable for every tenant of: ${missing.join(', ')}`,
      ).toEqual([]);

      // The entry renders whenever the permission is seeded, so the
      // destination must be explicitly ruled — a fallback-decided route means
      // a visible menu item can land on a not_found boundary. This is a hard
      // requirement for entry-point destinations; there is no exception list.
      expect(
        matchesRules(MSP_ROUTE_RULES, pin.destination),
        `"${pin.destination}" (${pin.reachedVia}) matches no explicit RouteRule — the product fallback decides its reachability, so the rendered entry can dead-end on a boundary page`,
      ).toBe(true);

      const unreachable = PRODUCTS.filter(
        (product) =>
          seedGrantsPermission(product, pin.permission, pin.action) &&
          resolveProductRouteBehavior(product, pin.destination) !== 'allowed',
      );
      expect(
        unreachable,
        `products whose catalog renders "${pin.reachedVia}" but whose route registry blocks ${pin.destination}: ${unreachable.join(', ')}`,
      ).toEqual([]);
    }
  });

  // Settings segments on disk that AlgaDesk deliberately does not get.
  // The route registry derives settings behavior from
  // getAllowedSettingsTabIds, so a segment missing from BOTH lists is a
  // page nobody classified — that is the failure this test exists for.
  const ALGADESK_BLOCKED_SETTINGS: Record<string, string> = {
    assets: 'PSA asset type configuration',
    billing: 'PSA billing configuration',
    extensions: 'PSA/EE extension management',
    'import-export': 'PSA data import/export',
    integrations: 'PSA integrations (QBO, Xero, RMM)',
    interactions: 'PSA interactions configuration',
    'mcp-server': 'PSA MCP server configuration',
    notifications: 'PSA notification settings',
    opportunities: 'PSA sales opportunities configuration',
    projects: 'PSA project management settings',
    secrets: 'PSA tenant secrets management requires durable secret storage',
    sla: 'PSA SLA configuration',
    'time-entry': 'PSA time tracking settings',
  };

  // Products with a settings allow-list, and the documented exclusions for
  // each. co_managed currently takes the help-desk tab set, so its exclusions
  // are AlgaDesk's; the cards that open time entry / SLA / notifications to
  // co_managed move those segments into its allow-list.
  const BLOCKED_SETTINGS_BY_PRODUCT: Record<'algadesk' | 'co_managed', Record<string, string>> = {
    algadesk: ALGADESK_BLOCKED_SETTINGS,
    co_managed: ALGADESK_BLOCKED_SETTINGS,
  };

  for (const [product, blocked] of Object.entries(BLOCKED_SETTINGS_BY_PRODUCT) as Array<
    ['algadesk' | 'co_managed', Record<string, string>]
  >) {
    it(`every settings page on disk is classified for ${product}: allowed tab or documented exclusion`, () => {
      const tabAllowList = getAllowedSettingsTabIds(product);
      const onDisk = listRouteDirSegments([
        'src/app/msp/settings',
        '../ee/server/src/app/msp/settings',
      ]);
      expect(onDisk.size).toBeGreaterThan(5);
      expect(tabAllowList.size, `${product} has an empty settings allow-list`).toBeGreaterThan(0);

      const unclassified = [...onDisk]
        .filter((segment) => !tabAllowList.has(segment) && !(segment in blocked))
        .sort();
      expect(
        unclassified,
        `settings pages on disk that are neither in the ${product} tab allow-list nor documented as blocked — classify them: ${unclassified.join(', ')}`,
      ).toEqual([]);

      // The classification must hold at the route layer, and the exclusion
      // list must stay honest as pages come and go.
      for (const segment of Object.keys(blocked)) {
        expect(
          onDisk.has(segment),
          `"${segment}" no longer has a settings page on disk — remove it from the ${product} exclusions`,
        ).toBe(true);
        expect(
          tabAllowList.has(segment),
          `"${segment}" is now in the ${product} tab allow-list — remove it from the ${product} exclusions`,
        ).toBe(false);
        expect(
          resolveProductRouteBehavior(product, `/msp/settings/${segment}`),
          `blocked settings segment "${segment}" must not resolve allowed for ${product}`,
        ).not.toBe('allowed');
      }
      for (const segment of [...onDisk].filter((s) => tabAllowList.has(s))) {
        expect(
          resolveProductRouteBehavior(product, `/msp/settings/${segment}`),
          `allowed settings segment "${segment}" must resolve allowed for ${product}`,
        ).toBe('allowed');
      }
    });
  }
});
