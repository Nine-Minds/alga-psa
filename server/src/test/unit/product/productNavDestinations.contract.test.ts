import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { PRODUCT_CODES, PRODUCT_NAV_DESTINATIONS, PRODUCT_NAV_TARGETS, type ProductCode } from '@alga-psa/types';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';
import { collectMspPageRoutes } from './support/appRouteInventory';

/**
 * Every product-neutral navigation target must land, for each product, on a
 * page that exists and that the product's route rules allow. A destination
 * that resolves `not_found` for its own product is a dead link that the
 * `/msp/go/<target>` dispatcher would hand to a customer.
 *
 * Known gaps are listed by `target.product` with the reason and the owner.
 * Each entry must still be a gap (a fixed gap fails until the entry is
 * removed), so this list can only shrink.
 */
const KNOWN_DESTINATION_GAPS: Record<string, string> = {
  // Main sends AlgaDesk provider setup to Integrations -> Providers, which the
  // AlgaDesk route rules deny (msp_settings_excluded). Pre-existing on main;
  // productRoutes.ts mirrors main and does not change it.
  'providers.algadesk': 'pre-existing main gap: /msp/settings/integrations is denied to algadesk',
};

const pathOf = (destination: string) => destination.split('?')[0];

describe('product navigation destinations', () => {
  const pages = collectMspPageRoutes();

  for (const target of PRODUCT_NAV_TARGETS) {
    for (const product of PRODUCT_CODES as readonly ProductCode[]) {
      const key = `${target}.${product}`;
      const destination = PRODUCT_NAV_DESTINATIONS[target][product];
      const reachable = pages.has(pathOf(destination))
        && resolveProductRouteBehavior(product, pathOf(destination)) === 'allowed';

      if (key in KNOWN_DESTINATION_GAPS) {
        it(`${key} is a documented gap (${KNOWN_DESTINATION_GAPS[key]}) and still unreachable`, () => {
          expect(reachable, `${key} -> ${destination} is now reachable; remove it from KNOWN_DESTINATION_GAPS`).toBe(false);
        });
        continue;
      }

      it(`${key} -> ${destination} is a page the ${product} route rules allow`, () => {
        expect(pages.has(pathOf(destination)), `no page on disk for ${destination}`).toBe(true);
        expect(resolveProductRouteBehavior(product, pathOf(destination))).toBe('allowed');
      });
    }
  }
});

/**
 * `productNavHref()` and the `*_SETUP_ENTRY_PATH` aliases point at
 * `/msp/go/<target>`, resolved by `server/src/app/msp/go/[target]/route.ts`.
 * L0a ships the table but not the dispatcher (no link uses it yet). The first
 * production file that renders one of these links must ship the dispatcher in
 * the same change, or every such link is a 404.
 */
describe('/msp/go dispatcher', () => {
  const repo = path.resolve(__dirname, '../../../../..');
  const dispatcher = path.join(repo, 'server/src/app/msp/go/[target]/route.ts');
  const LINK_EXPORTS = /\b(productNavHref|PROVIDER_SETUP_ENTRY_PATH|MAILBOX_SETUP_ENTRY_PATH|CALENDAR_SETUP_ENTRY_PATH)\b|['"`]\/msp\/go\//;

  it('no production code renders a /msp/go link unless the dispatcher route exists', () => {
    let listed = '';
    try {
      listed = execFileSync('git', ['grep', '-lE', LINK_EXPORTS.source, '--', 'server/src', 'packages', 'ee/server/src', 'shared'], {
        cwd: repo,
        encoding: 'utf8',
      });
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error; // 1 = no match
    }
    const files = listed
      .split('\n')
      .filter(Boolean)
      .filter((f) => !/\.(test|spec)\.[tj]sx?$|(^|\/)__tests__\/|(^|\/)test\//.test(f))
      .filter((f) => f !== 'packages/types/src/constants/productRoutes.ts' && f !== 'packages/types/src/constants/index.ts');
    if (!existsSync(dispatcher)) {
      expect(files, `these files render /msp/go links but ${path.relative(repo, dispatcher)} does not exist`).toEqual([]);
    }
  });
});
