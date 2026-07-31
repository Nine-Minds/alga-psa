'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ClientMaintenanceSummary, Asset, AssetTypeRegistryEntry } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BentoStat, BentoTile, BENTO_TONE_TEXT, type BentoTone } from '@alga-psa/ui/components/bento';
import { getClientMaintenanceSummary, listAssets } from '@alga-psa/assets/actions/assetActions';
import { unwrapAssetActionResult } from '@alga-psa/assets/actions/assetActionErrors';
import { loadAssetDetailDrawerData } from '@alga-psa/assets/actions/assetDrawerActions';
import { getAssetTypes } from '@alga-psa/assets/actions/assetTypeRegistryActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AlertTriangle } from 'lucide-react';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Button } from '@alga-psa/ui/components/Button';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import {
  AssetAgentCell,
  AssetCoverageCell,
  AssetIdentityMeta,
  AssetPatchingCell,
} from '@alga-psa/assets/components/assetListCells';
import { AssetDetailDrawerClient } from '@alga-psa/assets/components/AssetDetailDrawerClient';
import {
  ASSET_DRAWER_TABS,
  type AssetDrawerTab,
  tabToPanelParam,
  type AssetDrawerServerData,
} from '@alga-psa/assets/components/AssetDetailDrawer.types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientAssetsProps {
  clientId: string;
}

const ClientAssets: React.FC<ClientAssetsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const assetTypeOptions: SelectOption[] = [
    { value: 'all', label: t('clientTabs.assets.types.all', { defaultValue: 'All Asset Types' }) },
    { value: 'workstation', label: t('clientTabs.assets.types.workstation', { defaultValue: 'Workstation' }) },
    { value: 'network_device', label: t('clientTabs.assets.types.networkDevice', { defaultValue: 'Network Device' }) },
    { value: 'server', label: t('clientTabs.assets.types.server', { defaultValue: 'Server' }) },
    { value: 'mobile_device', label: t('clientTabs.assets.types.mobileDevice', { defaultValue: 'Mobile Device' }) },
    { value: 'printer', label: t('clientTabs.assets.types.printer', { defaultValue: 'Printer' }) }
  ];
  const [summary, setSummary] = useState<ClientMaintenanceSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [assetTypeEntries, setAssetTypeEntries] = useState<AssetTypeRegistryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Drawer state
  const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
  const [drawerData, setDrawerData] = useState<AssetDrawerServerData>({ asset: null });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const lastRequestIdRef = useRef<number>(0);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // F311: tenant registry powers custom-type labels/icons and filter options.
  useEffect(() => {
    let mounted = true;
    getAssetTypes()
      .then((entries) => {
        if (!mounted) return;
        if (isActionPermissionError(entries)) {
          setAssetTypeEntries([]);
          return;
        }
        setAssetTypeEntries(entries);
      })
      .catch((error) => {
        console.error('Error loading asset types:', error);
        if (mounted) setAssetTypeEntries([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const typeFilterOptions: SelectOption[] = [
    ...assetTypeOptions,
    ...(assetTypeEntries ?? [])
      .filter((entry) => !entry.is_builtin)
      .map((entry) => ({ value: entry.slug, label: entry.name })),
  ];

  // Drawer data loading
  const loadDrawerData = useCallback(async (assetId: string, tab: AssetDrawerTab) => {
    const requestId = lastRequestIdRef.current + 1;
    lastRequestIdRef.current = requestId;

    setDrawerLoading(true);
    setDrawerError(null);

    try {
      const result = await loadAssetDetailDrawerData({ assetId, panel: tabToPanelParam(tab) });

      if (lastRequestIdRef.current !== requestId) {
        return;
      }

      setDrawerData(result.data ?? { asset: null });
      setDrawerError(result.error ?? null);
    } catch (error) {
      if (lastRequestIdRef.current !== requestId) {
        return;
      }
      console.error('Failed to load asset drawer data', error);
      setDrawerData({ asset: null });
      setDrawerError(t('clientTabs.assets.drawerLoadError', { defaultValue: 'Unable to load asset details right now. Please try again.' }));
    } finally {
      if (lastRequestIdRef.current === requestId) {
        setDrawerLoading(false);
      }
    }
  }, []);

  const openDrawerForAsset = useCallback((asset: Asset, tab?: AssetDrawerTab) => {
    const nextTab = tab ?? ASSET_DRAWER_TABS.OVERVIEW;
    if (drawerAssetId !== asset.asset_id) {
      setDrawerAssetId(asset.asset_id);
    }
    if (!isDrawerOpen) {
      setIsDrawerOpen(true);
    }
    if (activeDrawerTab !== nextTab) {
      setActiveDrawerTab(nextTab);
    }
    void loadDrawerData(asset.asset_id, nextTab);
  }, [activeDrawerTab, drawerAssetId, isDrawerOpen, loadDrawerData]);

  const handleDrawerClose = useCallback(() => {
    setIsDrawerOpen(false);
    setDrawerAssetId(null);
    setActiveDrawerTab(ASSET_DRAWER_TABS.OVERVIEW);
    setDrawerData({ asset: null });
    setDrawerError(null);
  }, []);

  const handleDrawerTabChange = useCallback((tab: AssetDrawerTab) => {
    if (activeDrawerTab !== tab) {
      setActiveDrawerTab(tab);
    }
    if (drawerAssetId) {
      void loadDrawerData(drawerAssetId, tab);
    }
  }, [activeDrawerTab, drawerAssetId, loadDrawerData]);

  const loadData = async () => {
    try {
      setLoadError(false);
      const [summaryData, assetsData] = await Promise.all([
        getClientMaintenanceSummary(clientId).then(unwrapAssetActionResult),
        listAssets({
          client_id: clientId,
          asset_type: selectedType === 'all' ? undefined : selectedType,
          page: currentPage,
          limit: pageSize,
          // Patch/OS state lives on the per-type extension row.
          include_extension_data: true
        }).then(unwrapAssetActionResult)
      ]);
      setSummary(summaryData);
      setAssets(assetsData.assets);
      setTotalItems(assetsData.total);
    } catch (error) {
      // A failed load must not render as zero assets / zeroed summary cards.
      console.error('Error loading asset data:', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [clientId, selectedType, currentPage]);

  const handleAssetAdded = () => {
    loadData();
  };

  const columns = [
        {
      title: t('clientTabs.assets.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string, record: Asset) => (
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{value}</span>
          <AssetIdentityMeta asset={record} />
        </div>
      )
    },
    {
      title: t('clientTabs.assets.columns.agent', { defaultValue: 'Agent' }),
      dataIndex: 'agent_status',
      render: (_: unknown, record: Asset) => <AssetAgentCell asset={record} now={Date.now()} />
    },
    {
      title: t('clientTabs.assets.columns.patching', { defaultValue: 'Patching' }),
      dataIndex: 'patching',
      render: (_: unknown, record: Asset) => <AssetPatchingCell asset={record} now={Date.now()} />
    },
        // Column order is admission priority at narrow widths (computeColumnFit):
    // Status and Warranty End — what a tech or refresh pitch opens this view
    // for — outrank Serial/Location/Purchase Date. The old "Details" column
    // rendered "No details available" for most rows and is gone; specs live in
    // the asset drawer.
        {
      title: t('clientTabs.assets.columns.coverage', { defaultValue: 'Coverage' }),
      dataIndex: 'warranty_end_date',
      render: (_: unknown, record: Asset) => <AssetCoverageCell asset={record} now={Date.now()} />
    },
        {
      title: t('clientTabs.assets.columns.location', { defaultValue: 'Location' }),
      dataIndex: 'location',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Spinner size="lg" />
          <div className="space-y-1">
            <p className="text-lg font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.loading', { defaultValue: 'Loading assets...' })}</p>
            <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">{t('clientTabs.assets.loadingHint', { defaultValue: 'Please wait while we fetch your data' })}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" />
          <p className="text-sm text-gray-700 dark:text-[rgb(var(--color-text-700))]">
            {t('clientTabs.assets.loadError', { defaultValue: 'Unable to load assets right now.' })}
          </p>
          <Button
            id="client-assets-retry"
            variant="outline"
            onClick={() => { setIsLoading(true); void loadData(); }}
          >
            {t('clientTabs.assets.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </div>
    );
  }

  const complianceTone: BentoTone =
    (summary?.compliance_rate ?? 0) >= 90 ? 'good'
      : (summary?.compliance_rate ?? 0) >= 70 ? 'warn'
        : 'bad';

  return (
    <div className="space-y-4">
      {/* One BentoTile with the shared stat treatment, matching the asset detail
          hero and the client command centre. The previous cards were bespoke —
          per-card gradients, decorative blur circles, ring shadows and hover
          scaling — and matched nothing else in the app. */}
      <BentoTile id="client-assets-summary">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <BentoStat
            value={summary?.total_assets ?? 0}
            label={t('clientTabs.assets.summary.totalAssets', { defaultValue: 'Total assets' })}
          />
          <BentoStat
            value={
              <span className={BENTO_TONE_TEXT[complianceTone]}>
                {Math.round(summary?.compliance_rate ?? 0)}%
              </span>
            }
            label={t('clientTabs.assets.summary.maintenanceRate', { defaultValue: 'Maintenance rate' })}
          />
          <BentoStat
            value={
              <span className={BENTO_TONE_TEXT[(summary?.overdue_maintenances ?? 0) > 0 ? 'bad' : 'good']}>
                {summary?.overdue_maintenances ?? 0}
              </span>
            }
            label={t('clientTabs.assets.summary.overdueMaintenance', { defaultValue: 'Overdue maintenance' })}
          />
          <BentoStat
            value={summary?.upcoming_maintenances ?? 0}
            label={t('clientTabs.assets.summary.upcomingMaintenance', { defaultValue: 'Upcoming maintenance' })}
          />
        </div>
      </BentoTile>

      {/* Actions and Filters - Improved layout */}
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-700))] mb-2">
              {t('clientTabs.assets.filterByType', { defaultValue: 'Filter by Type' })}
            </label>
            <CustomSelect
              options={typeFilterOptions}
              value={selectedType}
              onValueChange={setSelectedType}
              placeholder={t('clientTabs.assets.typePlaceholder', { defaultValue: 'All asset types...' })}
            />
          </div>
          <div className="flex items-end">
            <QuickAddAsset
              clientId={clientId}
              onAssetAdded={handleAssetAdded}
            />
          </div>
        </div>
      </div>

      {/* Assets Table - Enhanced container */}
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-[rgb(var(--color-border-200))]">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.inventory.title', { defaultValue: 'Assets' })}</h2>
        </div>
        <DataTable
          id="client-assets-table"
          data={assets}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onRowClick={(asset: Asset) => openDrawerForAsset(asset)}
          totalItems={totalItems}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </div>

      <AssetDetailDrawerClient
        isOpen={isDrawerOpen}
        selectedAssetId={drawerAssetId}
        activeTab={activeDrawerTab}
        asset={drawerData.asset}
        maintenanceReport={drawerData.maintenanceReport}
        maintenanceHistory={drawerData.maintenanceHistory}
        history={drawerData.history}
        tickets={drawerData.tickets}
        documents={drawerData.documents}
        error={drawerError}
        isLoading={drawerLoading}
        onClose={handleDrawerClose}
        onTabChange={handleDrawerTabChange}
      />
    </div>
  );
};

export default ClientAssets;
