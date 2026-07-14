import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
  matchesDynamicPattern,
  matchesStaticPrefix,
  resolveProductRouteBehavior,
} from '../../../lib/productSurfaceRegistry';
import { getAllowedSettingsTabIds } from '../../../lib/settingsProductTabs';

type ProductCode = 'algadesk' | 'psa';
const PRODUCTS: ProductCode[] = ['algadesk', 'psa'];

// Pages that are reachable but intentionally carry no sidebar/settings-rail
// entry. Every entry states how the page IS reached; a prefix listed here
// without a real entry point is a product bug.
const INTENTIONALLY_UNLINKED: Record<string, string> = {
  '/msp/account': 'reached via the header avatar menu → Account, not the sidebar',
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

function readSeedSource(product: ProductCode): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), `../ee/server/seeds/onboarding/${product}/02_permissions.cjs`),
    'utf8',
  );
}

// Both seed dialects: psa uses `{ resource: 'x', action: 'y' }` rows,
// algadesk uses `['x', ['y', ...], 'description']` tuples.
function seedGrantsPermission(seedSource: string, resource: string, action: string): boolean {
  const objectRow = new RegExp(
    `resource:\\s*'${resource}'[^}]*action:\\s*'${action}'`,
  );
  const tupleRow = new RegExp(
    `\\['${resource}',\\s*\\[[^\\]]*'${action}'`,
  );
  return objectRow.test(seedSource) || tupleRow.test(seedSource);
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
      .filter(
        (pathname) =>
          !MSP_ROUTE_RULES.some(
            (rule) =>
              (rule.staticPrefixes && matchesStaticPrefix(pathname, rule.staticPrefixes)) ||
              (rule.dynamicPatterns && matchesDynamicPattern(pathname, rule.dynamicPatterns)),
          ),
      );

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
        (product) => !seedGrantsPermission(readSeedSource(product), pin.permission, pin.action),
      );
      expect(
        missing,
        `seed vocabularies missing ${pin.permission}:${pin.action} — "${pin.reachedVia}" is silently unreachable for every tenant of: ${missing.join(', ')}`,
      ).toEqual([]);

      // The entry renders whenever the permission is seeded, so the
      // destination must be explicitly ruled — a fallback-decided route means
      // a visible menu item can land on a not_found boundary. This is a hard
      // requirement for entry-point destinations; there is no exception list.
      const explicitlyRuled = MSP_ROUTE_RULES.some(
        (rule) =>
          (rule.staticPrefixes && matchesStaticPrefix(pin.destination, rule.staticPrefixes)) ||
          (rule.dynamicPatterns && matchesDynamicPattern(pin.destination, rule.dynamicPatterns)),
      );
      expect(
        explicitlyRuled,
        `"${pin.destination}" (${pin.reachedVia}) matches no explicit RouteRule — the product fallback decides its reachability, so the rendered entry can dead-end on a boundary page`,
      ).toBe(true);

      const unreachable = PRODUCTS.filter(
        (product) =>
          seedGrantsPermission(readSeedSource(product), pin.permission, pin.action) &&
          resolveProductRouteBehavior(product, pin.destination) !== 'allowed',
      );
      expect(
        unreachable,
        `products whose seeds render "${pin.reachedVia}" but whose route registry blocks ${pin.destination}: ${unreachable.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('settings coherence: route registry and settings tab allow-list agree for algadesk', () => {
    const tabAllowList = getAllowedSettingsTabIds('algadesk');
    const segments = new Set<string>();
    for (const section of settingsNavigationSections) {
      for (const href of collectHrefs(section.items)) {
        const tab = settingsTabOf(href);
        if (tab) segments.add(tab);
        const match = stripQuery(href).match(/^\/msp\/settings\/([^/]+)$/);
        if (match) segments.add(match[1]);
      }
    }

    const drifted = [...segments]
      .map((segment) => ({
        segment,
        routeAllows: resolveProductRouteBehavior('algadesk', `/msp/settings/${segment}`) === 'allowed',
        tabAllows: tabAllowList.has(segment),
      }))
      .filter(({ routeAllows, tabAllows }) => routeAllows !== tabAllows)
      .map(
        ({ segment, routeAllows }) =>
          `"${segment}" (route registry: ${routeAllows ? 'allowed' : 'blocked'}, tab allow-list: ${routeAllows ? 'blocked' : 'allowed'})`,
      );
    expect(
      drifted,
      `algadesk settings segments where the route registry and the tab allow-list disagree: ${drifted.join('; ')}`,
    ).toEqual([]);
  });
});
