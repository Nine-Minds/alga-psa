import type { ProductCode } from '@alga-psa/types';

const ALGA_DESK_ALLOWED_SETTINGS_TABS = [
  'general',
  'users',
  'teams',
  'ticketing',
  'email',
  'client-portal',
  'profile',
  'security',
  // AlgaDesk users can set a per-user language on their profile, so the tenant-level
  // language tab is available too.
  'language',
] as const;

export function getAllowedSettingsTabIds(productCode: ProductCode): Set<string> {
  if (productCode === 'algadesk') {
    return new Set(ALGA_DESK_ALLOWED_SETTINGS_TABS);
  }

  return new Set();
}
