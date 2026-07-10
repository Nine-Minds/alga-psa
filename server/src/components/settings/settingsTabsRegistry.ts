import { TIER_FEATURES } from '@alga-psa/types';

// Single source of truth for the MSP settings tabs. Each tab is now its own route
// segment under /msp/settings/<id> (so a route only pulls its own feature graph);
// this registry carries the cross-cutting metadata the per-segment shell needs —
// gating (tier feature / EE-only), the i18n label key, and the browser-tab title.
//
// LEVERAGE: pattern settings-tabs-twice — the sidebar (settingsNavigationSections in
// menuConfig.ts) still lists these ids/labels separately and can drift. Fold its
// section grouping into this registry next so both derive from one gated list.

export interface SettingsTabMeta {
  id: string;
  // i18n key under the 'msp/settings' namespace, e.g. 'tabs.integrations'.
  labelKey: string;
  // Browser-tab title (used by each segment's metadata).
  title: string;
  // Tier feature required to use the tab; when unmet the shell shows an upgrade notice.
  requiredFeature?: TIER_FEATURES;
  // Governance tabs that only exist on Enterprise builds.
  eeOnly?: boolean;
  // True once the tab has its own /msp/settings/<id> route segment (heavy static tabs
  // pulled out of the monolithic SettingsPage). Drives the ?tab= compat redirect.
  hasOwnRoute?: boolean;
}

export const SETTINGS_TABS: readonly SettingsTabMeta[] = [
  { id: 'general', labelKey: 'tabs.general', title: 'General' },
  { id: 'experimental-features', labelKey: 'tabs.experimentalFeatures', title: 'Experimental Features' },
  { id: 'client-portal', labelKey: 'tabs.clientPortal', title: 'Client Portal', hasOwnRoute: true },
  { id: 'users', labelKey: 'tabs.users', title: 'Users', hasOwnRoute: true },
  { id: 'teams', labelKey: 'tabs.teams', title: 'Teams' },
  { id: 'language', labelKey: 'tabs.language', title: 'Language', hasOwnRoute: true },
  { id: 'ticketing', labelKey: 'tabs.ticketing', title: 'Ticketing' },
  { id: 'projects', labelKey: 'tabs.projects', title: 'Projects', hasOwnRoute: true },
  { id: 'assets', labelKey: 'settings.assetTypes.tab', title: 'Assets' },
  { id: 'interactions', labelKey: 'tabs.interactions', title: 'Interactions', hasOwnRoute: true },
  { id: 'notifications', labelKey: 'tabs.notifications', title: 'Notifications' },
  { id: 'time-entry', labelKey: 'tabs.timeEntry', title: 'Time Entry', hasOwnRoute: true },
  { id: 'billing', labelKey: 'tabs.billing', title: 'Billing', hasOwnRoute: true },
  { id: 'secrets', labelKey: 'tabs.secrets', title: 'Secrets', hasOwnRoute: true },
  { id: 'import-export', labelKey: 'tabs.importExport', title: 'Import/Export', hasOwnRoute: true },
  { id: 'email', labelKey: 'tabs.email', title: 'Email', hasOwnRoute: true },
  { id: 'integrations', labelKey: 'tabs.integrations', title: 'Integrations', requiredFeature: TIER_FEATURES.INTEGRATIONS, hasOwnRoute: true },
  { id: 'extensions', labelKey: 'tabs.extensions', title: 'Extensions', requiredFeature: TIER_FEATURES.EXTENSIONS },
  { id: 'mcp-server', labelKey: 'tabs.mcpServer', title: 'MCP Server', eeOnly: true, hasOwnRoute: true },
];

// Ids of tabs that now live at /msp/settings/<id>; the landing page redirects legacy
// ?tab=<id> links to them.
export const MIGRATED_SETTINGS_TAB_IDS: ReadonlySet<string> = new Set(
  SETTINGS_TABS.filter((tab) => tab.hasOwnRoute).map((tab) => tab.id),
);

const TABS_BY_ID = new Map(SETTINGS_TABS.map((tab) => [tab.id, tab]));

export function getSettingsTab(id: string): SettingsTabMeta | undefined {
  return TABS_BY_ID.get(id);
}

export function getSettingsTabTitle(id: string | undefined): string {
  return (id && TABS_BY_ID.get(id)?.title) || 'Settings';
}
