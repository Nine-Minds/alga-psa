'use server';

import {
  Asset,
  AssetHistory,
  AssetMaintenanceHistory,
  AssetMaintenanceReport,
  AssetTicketSummary,
} from '@alga-psa/types';
import type { IDocument } from '@alga-psa/types';
import {
  getAsset,
  getAssetHistory,
  getAssetMaintenanceReport,
  getAssetLinkedTickets,
} from './assetActions';
import { getAssetDocuments } from './assetDocumentActions';
import {
  ASSET_DRAWER_TABS,
  panelParamToTab,
  AssetDetailDrawerProps,
  AssetDrawerServerData,
  AssetDrawerTab,
} from '../components/AssetDetailDrawer.types';

export async function loadAssetDetailDrawerData({ assetId, panel }: AssetDetailDrawerProps) {
  const activeTab = panelParamToTab(panel ?? null);
  const serverData: AssetDrawerServerData = {
    asset: null,
  };
  let error: string | null = null;

  if (assetId) {
    try {
      const asset = await getAsset(assetId);
      serverData.asset = asset;

      if (asset) {
        await loadTabData(activeTab, asset, serverData);
      }
    } catch (err) {
      console.error('Failed to load asset drawer data:', err);
      error = 'Unable to load asset details right now. Please try again.';
    }
  }

  return {
    activeTab,
    data: serverData,
    error,
  };
}

async function loadTabData(tab: AssetDrawerTab, asset: Asset, target: AssetDrawerServerData) {
  switch (tab) {
    case ASSET_DRAWER_TABS.OVERVIEW: {
      const [report, history] = await Promise.all([
        safeGetAssetMaintenanceReport(asset.asset_id),
        safeGetAssetHistory(asset.asset_id),
      ]);
      target.maintenanceReport = report;
      target.maintenanceHistory = report?.maintenance_history as AssetMaintenanceHistory[] | undefined;
      target.history = history ?? [];
      break;
    }
    case ASSET_DRAWER_TABS.MAINTENANCE: {
      const report = await safeGetAssetMaintenanceReport(asset.asset_id);
      target.maintenanceReport = report;
      target.maintenanceHistory = report?.maintenance_history as AssetMaintenanceHistory[] | undefined;
      break;
    }
    case ASSET_DRAWER_TABS.TICKETS: {
      target.tickets = (await safeGetAssetLinkedTickets(asset.asset_id)) ?? [];
      break;
    }
    case ASSET_DRAWER_TABS.DOCUMENTS: {
      target.documents = await safeGetAssetDocuments(asset.asset_id);
      break;
    }
    case ASSET_DRAWER_TABS.CONFIGURATION:
    default:
      break;
  }
}

async function safeGetAssetMaintenanceReport(assetId: string): Promise<AssetMaintenanceReport | null> {
  try {
    return await getAssetMaintenanceReport(assetId);
  } catch (error) {
    console.error('Failed to load asset maintenance report', error);
    return null;
  }
}

async function safeGetAssetHistory(assetId: string): Promise<AssetHistory[] | null> {
  try {
    return await getAssetHistory(assetId);
  } catch (error) {
    console.error('Failed to load asset history', error);
    return null;
  }
}

async function safeGetAssetLinkedTickets(assetId: string): Promise<AssetTicketSummary[] | null> {
  try {
    return await getAssetLinkedTickets(assetId);
  } catch (error) {
    console.error('Failed to load linked tickets', error);
    return null;
  }
}

async function safeGetAssetDocuments(assetId: string): Promise<IDocument[] | null> {
  try {
    return await getAssetDocuments(assetId);
  } catch (error) {
    console.error('Failed to load asset documents', error);
    return null;
  }
}
