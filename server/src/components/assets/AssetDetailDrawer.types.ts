import type {
  Asset,
  AssetHistory,
  AssetMaintenanceHistory,
  AssetMaintenanceReport,
  AssetTicketSummary,
} from 'server/src/interfaces/asset.interfaces';
import type { IDocument } from 'server/src/interfaces/document.interface';

export const ASSET_DRAWER_TABS = {
  OVERVIEW: 'Overview',
  MAINTENANCE: 'Maintenance',
  TICKETS: 'Tickets',
  CONFIGURATION: 'Configuration',
  DOCUMENTS: 'Documents',
} as const;

export type AssetDrawerTab = typeof ASSET_DRAWER_TABS[keyof typeof ASSET_DRAWER_TABS];

export type AssetDrawerPanelParam = 'overview' | 'maintenance' | 'tickets' | 'configuration' | 'documents';

export const PANEL_PARAM_BY_TAB: Record<AssetDrawerTab, AssetDrawerPanelParam> = {
  [ASSET_DRAWER_TABS.OVERVIEW]: 'overview',
  [ASSET_DRAWER_TABS.MAINTENANCE]: 'maintenance',
  [ASSET_DRAWER_TABS.TICKETS]: 'tickets',
  [ASSET_DRAWER_TABS.CONFIGURATION]: 'configuration',
  [ASSET_DRAWER_TABS.DOCUMENTS]: 'documents',
};

const TAB_BY_PANEL_PARAM: Record<AssetDrawerPanelParam, AssetDrawerTab> = {
  overview: ASSET_DRAWER_TABS.OVERVIEW,
  maintenance: ASSET_DRAWER_TABS.MAINTENANCE,
  tickets: ASSET_DRAWER_TABS.TICKETS,
  configuration: ASSET_DRAWER_TABS.CONFIGURATION,
  documents: ASSET_DRAWER_TABS.DOCUMENTS,
};

export interface AssetDetailDrawerProps {
  assetId: string | null;
  panel?: string | null;
}

export interface AssetDrawerServerData {
  asset: Asset | null;
  maintenanceReport?: AssetMaintenanceReport | null;
  maintenanceHistory?: AssetMaintenanceHistory[] | null;
  history?: AssetHistory[] | null;
  tickets?: AssetTicketSummary[] | null;
  documents?: IDocument[] | null;
}

export function panelParamToTab(value: string | null | undefined): AssetDrawerTab {
  if (!value) {
    return ASSET_DRAWER_TABS.OVERVIEW;
  }

  const normalized = value.toLowerCase();
  if (TAB_BY_PANEL_PARAM[normalized as AssetDrawerPanelParam]) {
    return TAB_BY_PANEL_PARAM[normalized as AssetDrawerPanelParam];
  }

  return ASSET_DRAWER_TABS.OVERVIEW;
}

export function tabToPanelParam(tab: AssetDrawerTab): AssetDrawerPanelParam {
  return PANEL_PARAM_BY_TAB[tab];
}
