'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { loadAssetDetailDrawerData } from '../../actions/assetDrawerActions';
import {
  ASSET_DRAWER_TABS,
  tabToPanelParam,
  type AssetDrawerServerData,
  type AssetDrawerTab,
} from '../AssetDetailDrawer.types';

/**
 * Opens an asset in the asset quick-view drawer, for surfaces that only have an
 * asset id and no list of their own (the contact page's Assets tile, say) —
 * reading an asset should not cost the operator the page they were on.
 *
 * Spread the returned `drawerProps` onto `AssetDetailDrawerClient`.
 */
export function useAssetDetailDrawer() {
  const { t } = useTranslation('msp/assets');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
  const [data, setData] = useState<AssetDrawerServerData>({ asset: null });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Only the newest request may write: a second asset opened mid-flight would
  // otherwise be overwritten by the first one's reply.
  const requestRef = useRef(0);

  const load = useCallback(async (id: string, tab: AssetDrawerTab) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const result = await loadAssetDetailDrawerData({ assetId: id, panel: tabToPanelParam(tab) });
      if (requestRef.current !== requestId) return;
      setData(result.data ?? { asset: null });
      setError(result.error ?? null);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      console.error('Failed to load asset drawer data', err);
      setData({ asset: null });
      // Same failure, same sentence as the ticket/project asset list — reusing
      // its key keeps one translation of it instead of two that can drift.
      setError(t('associatedAssets.errors.loadDrawerFailed', {
        defaultValue: 'Unable to load asset details right now. Please try again.',
      }));
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [t]);

  const openAsset = useCallback((id: string, tab: AssetDrawerTab = ASSET_DRAWER_TABS.OVERVIEW) => {
    setAssetId(id);
    setActiveTab(tab);
    setData({ asset: null });
    void load(id, tab);
  }, [load]);

  const close = useCallback(() => {
    requestRef.current += 1;
    setAssetId(null);
    setData({ asset: null });
    setError(null);
    setIsLoading(false);
  }, []);

  const changeTab = useCallback((tab: AssetDrawerTab) => {
    setActiveTab(tab);
    if (assetId) void load(assetId, tab);
  }, [assetId, load]);

  return {
    openAsset,
    drawerProps: {
      isOpen: Boolean(assetId),
      selectedAssetId: assetId,
      activeTab,
      asset: data.asset,
      maintenanceReport: data.maintenanceReport,
      maintenanceHistory: data.maintenanceHistory,
      history: data.history,
      tickets: data.tickets,
      documents: data.documents,
      error,
      isLoading,
      onClose: close,
      onTabChange: changeTab,
    },
  };
}
