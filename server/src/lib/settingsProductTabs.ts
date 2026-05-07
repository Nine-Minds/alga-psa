import type { ProductCode } from '@alga-psa/types';

const ALGADESK_ALLOWED_SETTINGS_TABS = [
  'general',
  'users',
  'teams',
  'ticketing',
  'knowledge-base',
  'email',
  'client-portal',
  'profile',
  'security',
] as const;

export function getAllowedSettingsTabIds(productCode: ProductCode): Set<string> {
  if (productCode === 'algadesk') {
    return new Set(ALGADESK_ALLOWED_SETTINGS_TABS);
  }

  return new Set();
}
