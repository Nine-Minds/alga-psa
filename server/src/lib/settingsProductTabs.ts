import type { ProductCode } from '@alga-psa/types';

const ALGA_DESK_ALLOWED_SETTINGS_TABS = [
  'general',
  'users',
  'teams',
  'ticketing',
  'email',
  'appearance',
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

  if (productCode === 'co_managed') {
    // Co-managed workspaces include operational time tracking (the
    // /msp/time-entry and /msp/time-sheet-approvals routes are already
    // allowed for this product). Time entry is impossible without a current
    // time period, and periods/period settings are managed only on the
    // time-entry settings tab, so the tab must be reachable too. The tab
    // contains no rates, contracts, or invoice configuration.
    return new Set([...ALGA_DESK_ALLOWED_SETTINGS_TABS, 'sla', 'notifications', 'time-entry']);
  }

  return new Set();
}
