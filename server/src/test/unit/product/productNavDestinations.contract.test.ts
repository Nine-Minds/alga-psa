import { describe, expect, it } from 'vitest';

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
  // The capability-scoped provider page ships with the co-managed workspace (L1a).
  'providers.co_managed': 'page /msp/co-management/providers and its route rule ship in L1a',
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
