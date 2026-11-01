import type { ProductCode } from '@alga-psa/types';

const ALGA_DESK_ALLOWED_SETTINGS_TABS = [
  'general',
  'users',
  'teams',
  'ticketing',
  'tags',
  'email',
  'appearance',
  'client-portal',
  'profile',
  'security',
  // AlgaDesk users can set a per-user language on their profile, so the tenant-level
  // language tab is available too.
  'language',
] as const;

/** Products whose settings surface is an allow-list. PSA sees every tab. */
export type SettingsRestrictedProduct = Exclude<ProductCode, 'psa'>;

/**
 * Allowed settings tabs per restricted product. Keyed by every non-PSA product
 * code, so adding a product to `PRODUCT_CODES` fails to compile until it takes
 * a position here; a product missing from this record would otherwise resolve
 * every `/msp/settings/<tab>` to `not_found`.
 *
 * `co_managed` gets the help-desk tabs that back the routes its route rules
 * allow today (`msp_core_helpdesk`). Tabs that back routes later cards open
 * (time entry, SLA, notifications) are added by those cards with their routes.
 */
const ALLOWED_SETTINGS_TABS_BY_PRODUCT: Record<SettingsRestrictedProduct, readonly string[]> = {
  algadesk: ALGA_DESK_ALLOWED_SETTINGS_TABS,
  co_managed: ALGA_DESK_ALLOWED_SETTINGS_TABS,
};

export function isSettingsRestrictedProduct(productCode: ProductCode): productCode is SettingsRestrictedProduct {
  return productCode !== 'psa';
}

/** Empty for PSA, which does not use an allow-list. */
export function getAllowedSettingsTabIds(productCode: ProductCode): Set<string> {
  return isSettingsRestrictedProduct(productCode)
    ? new Set(ALLOWED_SETTINGS_TABS_BY_PRODUCT[productCode])
    : new Set();
}
