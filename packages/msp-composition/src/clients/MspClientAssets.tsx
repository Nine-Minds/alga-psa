'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ClientMaintenanceSummary, Asset, AssetTypeRegistryEntry } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { getClientMaintenanceSummary, listAssets } from '@alga-psa/assets/actions/assetActions';
import { loadAssetDetailDrawerData } from '@alga-psa/assets/actions/assetDrawerActions';
import { getAssetTypes } from '@alga-psa/assets/actions/assetTypeRegistryActions';
import { fallbackAssetTypeLabel, resolveAssetTypeLabel } from '@alga-psa/assets/lib/assetTypeDisplay';
import { isBuiltinAssetTypeSlug } from '@alga-psa/assets/lib/assetTypeAttributes';
import { getIconComponent } from '@alga-psa/ui/components/IconPicker';
import {
  Boxes,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Monitor,
  Server,
  Smartphone,
  Printer,
  Network,
  TrendingUp
} from 'lucide-react';
import Link from 'next/link';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Button } from '@alga-psa/ui/components/Button';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
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
        if (mounted) setAssetTypeEntries(entries);
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

  const getAssetTypeIcon = (type: string): React.JSX.Element => {
    const iconProps = { className: "h-4 w-4 text-gray-600 dark:text-[rgb(var(--color-text-500))]" };
    switch (type.toLowerCase()) {
      case 'workstation':
        return <Monitor {...iconProps} />;
      case 'server':
        return <Server {...iconProps} />;
      case 'mobile_device':
        return <Smartphone {...iconProps} />;
      case 'printer':
        return <Printer {...iconProps} />;
      case 'network_device':
        return <Network {...iconProps} />;
      default: {
        const customIcon = assetTypeEntries?.find(
          (entry) => !entry.is_builtin && entry.slug === type
        )?.icon;
        if (customIcon) {
          const CustomIcon = getIconComponent(customIcon);
          return <CustomIcon {...iconProps} />;
        }
        return <Boxes {...iconProps} />;
      }
    }
  };

  const loadData = async () => {
    try {
      setLoadError(false);
      const [summaryData, assetsData] = await Promise.all([
        getClientMaintenanceSummary(clientId),
        listAssets({
          client_id: clientId,
          asset_type: selectedType === 'all' ? undefined : selectedType,
          page: currentPage,
          limit: pageSize
        })
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
      title: t('clientTabs.assets.columns.assetTag', { defaultValue: 'Asset Tag' }),
      dataIndex: 'asset_tag',
      render: (value: string, record: Asset) => (
        <Link
          href={`/msp/assets/${record.asset_id}`}
          className="font-medium text-primary-600 hover:text-primary-700 hover:underline transition-colors"
          prefetch={false}
        >
          {value}
        </Link>
      )
    },
    {
      title: t('clientTabs.assets.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string) => (
        <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{value}</span>
      )
    },
    {
      title: t('clientTabs.assets.columns.type', { defaultValue: 'Type' }),
      dataIndex: 'asset_type',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] rounded-lg border border-gray-100 dark:border-[rgb(var(--color-border-200))]">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-700))]">
            {isBuiltinAssetTypeSlug(value)
              ? fallbackAssetTypeLabel(value)
              : resolveAssetTypeLabel(assetTypeEntries, value)}
          </span>
        </div>
      )
    },
    // Column order is admission priority at narrow widths (computeColumnFit):
    // Status and Warranty End — what a tech or refresh pitch opens this view
    // for — outrank Serial/Location/Purchase Date. The old "Details" column
    // rendered "No details available" for most rows and is gone; specs live in
    // the asset drawer.
    {
      title: t('clientTabs.assets.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value: string) => (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
          value === 'active'
            ? 'bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))] ring-1 ring-[rgb(var(--badge-success-border))]'
            : value === 'inactive'
            ? 'bg-[rgb(var(--badge-default-bg))] text-[rgb(var(--badge-default-text))] ring-1 ring-[rgb(var(--badge-default-border))]'
            : 'bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))] ring-1 ring-[rgb(var(--badge-warning-border))]'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
            value === 'active' ? 'bg-[rgb(var(--badge-success-text))]' : value === 'inactive' ? 'bg-[rgb(var(--badge-default-text))]' : 'bg-[rgb(var(--badge-warning-text))]'
          }`}></span>
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </span>
      )
    },
    {
      title: t('clientTabs.assets.columns.warrantyEnd', { defaultValue: 'Warranty End' }),
      dataIndex: 'warranty_end_date',
      render: (value: string | null) => {
        if (!value) return <span className="text-sm text-gray-400 dark:text-[rgb(var(--color-text-400))]">—</span>;
        const date = new Date(value);
        const isExpired = date < new Date();
        return (
          <span className={`text-sm font-medium ${isExpired ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-[rgb(var(--color-text-600))]'}`}>
            {date.toLocaleDateString()}
            {isExpired && <span className="ml-1 text-xs">{t('clientTabs.assets.expiredSuffix', { defaultValue: '(Expired)' })}</span>}
          </span>
        );
      }
    },
    {
      title: t('clientTabs.assets.columns.serialNumber', { defaultValue: 'Serial number' }),
      dataIndex: 'serial_number',
      render: (value: string | null) => (
        <span className="font-mono text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
    {
      title: t('clientTabs.assets.columns.location', { defaultValue: 'Location' }),
      dataIndex: 'location',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
    {
      title: t('clientTabs.assets.columns.purchaseDate', { defaultValue: 'Purchase Date' }),
      dataIndex: 'purchase_date',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">
          {value ? new Date(value).toLocaleDateString() : '—'}
        </span>
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

  return (
    <div className="space-y-8">
      {/* Summary Cards - Redesigned with gradients and better visual hierarchy */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Assets Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-blue-100/50 dark:border-blue-800/30">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-blue-500/10 rounded-lg ring-1 ring-blue-500/20">
                <Boxes className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-2.5 py-1 rounded-full">{t('clientTabs.assets.summary.activeBadge', { defaultValue: 'Active' })}</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900/60 dark:text-blue-300/80">{t('clientTabs.assets.summary.totalAssets', { defaultValue: 'Total Assets' })}</p>
              <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{summary?.total_assets || 0}</p>
            </div>
          </div>
        </div>

        {/* Maintenance Rate Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/40 dark:to-green-950/40 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-emerald-100/50 dark:border-emerald-800/30">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-emerald-500/10 rounded-lg ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-emerald-900/60 dark:text-emerald-300/80">{t('clientTabs.assets.summary.maintenanceRate', { defaultValue: 'Maintenance Rate' })}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">
                  {Math.round(summary?.compliance_rate || 0)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Overdue Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-amber-100/50 dark:border-amber-800/30">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-amber-500/10 rounded-lg ring-1 ring-amber-500/20">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              {(summary?.overdue_maintenances || 0) > 0 && (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-2.5 py-1 rounded-full">{t('clientTabs.assets.summary.needsAttention', { defaultValue: 'Needs attention' })}</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900/60 dark:text-amber-300/80">{t('clientTabs.assets.summary.overdueMaintenance', { defaultValue: 'Overdue Maintenance' })}</p>
              <p className="text-3xl font-bold text-amber-900 dark:text-amber-100">{summary?.overdue_maintenances || 0}</p>
            </div>
          </div>
        </div>

        {/* Upcoming Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/40 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-violet-100/50 dark:border-violet-800/30">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-violet-500/10 rounded-lg ring-1 ring-violet-500/20">
                <Clock className="h-6 w-6 text-violet-600 dark:text-violet-400" />
              </div>
              <span className="text-xs font-medium text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/50 px-2.5 py-1 rounded-full">{t('clientTabs.assets.summary.scheduledBadge', { defaultValue: 'Scheduled' })}</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-violet-900/60 dark:text-violet-300/80">{t('clientTabs.assets.summary.upcomingMaintenance', { defaultValue: 'Upcoming Maintenance' })}</p>
              <p className="text-3xl font-bold text-violet-900 dark:text-violet-100">{summary?.upcoming_maintenances || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions and Filters - Improved layout */}
      <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-xl shadow-sm border border-gray-100 dark:border-[rgb(var(--color-border-200))] p-6">
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
      <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-xl shadow-sm border border-gray-100 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
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

      {/* Bottom Grid - Maintenance Type Breakdown and Asset Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Maintenance Type Breakdown */}
        {summary?.maintenance_by_type && Object.keys(summary.maintenance_by_type).length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-950/40 dark:to-gray-950/40 rounded-xl shadow-sm border border-gray-100 dark:border-[rgb(var(--color-border-200))] p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.maintenanceTypes.title', { defaultValue: 'Maintenance Types' })}</h3>
                <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">{t('clientTabs.assets.maintenanceTypes.subtitle', { defaultValue: 'Breakdown by category' })}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(summary.maintenance_by_type).map(([type, count]): React.JSX.Element => (
                <div key={type} className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-gray-100 dark:border-[rgb(var(--color-border-200))] hover:border-gray-200 dark:hover:border-[rgb(var(--color-border-300))] transition-colors">
                  <p className="text-xs font-medium text-gray-500 dark:text-[rgb(var(--color-text-500))] uppercase tracking-wide mb-1">{type}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{count}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Asset Stats */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 rounded-xl shadow-sm border border-blue-100 dark:border-blue-800/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
              <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.overview.title', { defaultValue: 'Asset Overview' })}</h3>
              <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">{t('clientTabs.assets.overview.subtitle', { defaultValue: 'Maintenance statistics' })}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-[rgb(var(--color-text-600))]">{t('clientTabs.assets.overview.assetsWithMaintenance', { defaultValue: 'Assets with Maintenance' })}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))] mt-1">{summary?.assets_with_maintenance || 0}</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
                <p className="text-xs font-medium text-gray-500 dark:text-[rgb(var(--color-text-500))] uppercase tracking-wide mb-1">{t('clientTabs.assets.overview.totalSchedules', { defaultValue: 'Total Schedules' })}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{summary?.total_schedules || 0}</p>
              </div>

              <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
                <p className="text-xs font-medium text-gray-500 dark:text-[rgb(var(--color-text-500))] uppercase tracking-wide mb-1">{t('clientTabs.assets.overview.coverageRate', { defaultValue: 'Coverage Rate' })}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))]">
                  {(summary?.assets_with_maintenance || 0) > 0
                    ? Math.round(
                        ((summary?.total_schedules || 0) /
                          (summary?.assets_with_maintenance || 1)) *
                          100
                      )
                    : 0}%
                </p>
              </div>
            </div>
          </div>
        </div>
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
