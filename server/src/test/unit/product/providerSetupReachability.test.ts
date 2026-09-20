import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAILBOX_SETUP_ENTRY_PATH,
  PRODUCT_NAV_DESTINATIONS,
  PRODUCT_NAV_TARGETS,
  PROVIDER_SETUP_ENTRY_PATH,
  resolveProductNavDestination,
} from '@alga-psa/types';
import { MSP_ROUTE_RULES, resolveProductApiBehavior, resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';
import { matchesRules } from './support/appRouteInventory';

const repoRoot = path.resolve(process.cwd(), '..');

/**
 * CF005/CF006. A co-managed customer administrator followed
 * Settings -> Email -> Inbound -> "Open Providers" into
 * `/msp/settings/integrations?category=providers`, which the co-managed product
 * boundary denies. The product instructed the customer to register its own
 * Microsoft Entra application and then blocked the only surface that could
 * store it.
 *
 * These assertions fail if the capability-scoped route, the product-neutral
 * entry point, or the link rewiring is removed.
 */

/**
 * Products whose provider-setup destination is known NOT to resolve. This is a
 * report, not a waiver: each entry is an open defect with an owner.
 */
const UNRESOLVED_NAV_DESTINATIONS: Record<string, string> = {
  'providers/algadesk':
    'AlgaDesk has the same dead end: /msp/settings/integrations is not_found for it, and an '
    + 'enterprise-edition AlgaDesk tenant still renders the Open Providers entry. Found while '
    + 'fixing the co-managed case (CF005/CF006); out of that card\'s scope and reported as a '
    + 'separate open defect rather than fixed here.',
};

function stripQuery(href: string): string {
  return href.split('?')[0];
}

function sourceFiles(): string[] {
  const roots = [
    'packages/integrations/src',
    'server/src/app',
    'server/src/components',
    'server/src/lib',
  ];
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        // Test files are excluded: some legitimately carry the PSA path as an
        // opaque OAuth-state fixture. The link contract for the Microsoft form
        // is pinned by microsoftProviders.providersFirst.test.ts instead.
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));
  return found;
}

describe('provider setup reachability', () => {
  it('routes every product to a destination that product is allowed to open', () => {
    const unreachable = PRODUCT_NAV_TARGETS.flatMap((target) =>
      Object.entries(PRODUCT_NAV_DESTINATIONS[target]).map(([product, destination]) =>
        ({ key: `${target}/${product}`, product, destination })))
      .filter(({ key }) => !(key in UNRESOLVED_NAV_DESTINATIONS))
      .filter(({ product, destination }) =>
        resolveProductRouteBehavior(product as never, stripQuery(destination)) !== 'allowed');

    expect(
      unreachable.map(({ key, destination }) => `${key} -> ${destination}`),
      'a product is told to configure its own provider application and then sent to a route its '
      + 'product boundary denies',
    ).toEqual([]);
  });

  it('keeps the co-managed destination capability-scoped instead of exempting the integrations page', () => {
    // The whole integrations page also hosts accounting, RMM, payments and the
    // other categories the co-managed capability boundary excludes. Allowing it
    // would widen the boundary far past the provider capability, so it must
    // stay denied even though provider setup is now reachable.
    expect(resolveProductRouteBehavior('co_managed', '/msp/settings/integrations')).toBe('not_found');
    expect(resolveProductRouteBehavior('co_managed', '/msp/integrations')).toBe('not_found');
    expect(resolveProductNavDestination('providers', 'co_managed')).toBe('/msp/co-management/providers');
    expect(resolveProductRouteBehavior('co_managed', '/msp/co-management/providers')).toBe('allowed');
    // Return navigation out of the workbench must also stay inside the boundary.
    expect(resolveProductNavDestination('mailbox', 'co_managed')).toBe('/msp/settings/email');
    expect(resolveProductRouteBehavior('co_managed', '/msp/settings/email')).toBe('allowed');
  });

  it('leaves every other co-managed-excluded integration category denied', () => {
    for (const excluded of ['/msp/settings/integrations', '/msp/settings/extensions', '/msp/billing',
      '/msp/settings/billing', '/msp/settings/import-export', '/msp/settings/mcp-server']) {
      expect(
        resolveProductRouteBehavior('co_managed', excluded),
        `${excluded} must stay denied for co_managed`,
      ).not.toBe('allowed');
    }
    // The excluded integration categories are also denied at the API layer, so
    // the new page cannot be used as a bridge to them.
    for (const denied of ['/api/v1/accounting-exports', '/api/v1/rmm', '/api/v1/integrations']) {
      expect(
        resolveProductApiBehavior('co_managed', denied),
        `${denied} must stay denied for co_managed`,
      ).toBe('denied');
    }
  });

  it('has an explicit route rule for the co-managed provider page rather than riding the fallback', () => {
    expect(matchesRules(MSP_ROUTE_RULES, '/msp/co-management/providers')).toBe(true);
  });

  it('ships the capability-scoped page and the product-neutral dispatcher', () => {
    const page = path.join(repoRoot, 'server/src/app/msp/co-management/providers/page.tsx');
    const dispatcher = path.join(repoRoot, 'server/src/app/msp/go/[target]/route.ts');
    expect(fs.existsSync(page), `${page} must exist`).toBe(true);
    expect(fs.existsSync(dispatcher), `${dispatcher} must exist`).toBe(true);
    expect(PROVIDER_SETUP_ENTRY_PATH).toBe('/msp/go/providers');
    expect(MAILBOX_SETUP_ENTRY_PATH).toBe('/msp/go/mailbox');
    // An unknown target must 404 rather than redirect wherever the URL says.
    expect(fs.readFileSync(dispatcher, 'utf8')).toContain('isProductNavTarget');

    // The scoped page renders the provider workbench only. If it ever composes
    // the whole integrations page, the capability scoping is gone.
    const setup = fs.readFileSync(
      path.join(repoRoot, 'server/src/components/co-managed/CoManagedProviderSetup.tsx'), 'utf8');
    expect(setup).toContain('ProviderCredentialsWorkbench');
    expect(setup).not.toContain('IntegrationsSettingsPage');
  });

  it('does not put the release flag between the customer and its own provider credentials', () => {
    // CoManagedFeatureBoundary renders `fallback ?? null`, and its contract says
    // a caller that replaces a whole route must supply a fallback "or the route
    // renders blank when the flag is off". The entry point that leads here --
    // the Open Providers button on Settings -> Email -> Inbound -- is gated only
    // on enterprise edition, so gating the destination and not the entry point
    // turns the flag into a blank-page dead end that is strictly worse than the
    // product boundary card this route replaced.
    // Comments are stripped: explaining the decision in prose is fine, using the
    // flag is not.
    const code = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const page = code('server/src/app/msp/co-management/providers/page.tsx');
    const entry = code('packages/integrations/src/components/email/EmailProviderConfiguration.tsx');

    for (const flagReference of ['release-v1-6-feature', 'useFeatureFlag', 'CoManagedFeatureBoundary']) {
      expect(
        entry.includes(flagReference),
        `the Open Providers entry point references ${flagReference}; if the entry point becomes `
        + 'flag-gated, revisit whether the destination should be too',
      ).toBe(false);
      expect(
        page.includes(flagReference),
        `the provider route references ${flagReference} while its entry point does not — with the flag `
        + 'off this renders a blank page instead of the provider workbench',
      ).toBe(false);
    }
  });

  it('has no source link left that sends a user straight at a product-specific provider page', () => {
    const offenders = sourceFiles()
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('/msp/settings/integrations?category=providers')
          || source.includes('/msp/settings/integrations?category=communication');
      })
      .map((file) => path.relative(repoRoot, file));

    expect(
      offenders,
      'these link straight at the PSA page instead of PROVIDER_SETUP_ENTRY_PATH, which is exactly '
      + 'how the co-managed dead end was produced',
    ).toEqual([]);
  });
});
