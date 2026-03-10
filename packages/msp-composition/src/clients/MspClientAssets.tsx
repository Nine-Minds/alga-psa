'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ClientMaintenanceSummary, Asset } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { getClientMaintenanceSummary, listAssets } from '@alga-psa/assets/actions/assetActions';
import { loadAssetDetailDrawerData } from '@alga-psa/assets/actions/assetDrawerActions';
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
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import { AssetDetailDrawerClient } from '@alga-psa/assets/components/AssetDetailDrawerClient';
import {
  ASSET_DRAWER_TABS,
  type AssetDrawerTab,
  tabToPanelParam,
  type AssetDrawerServerData,
} from '@alga-psa/assets/components/AssetDetailDrawer.types';

interface ClientAssetsProps {
  clientId: string;
}

type AssetType = 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer';

const ASSET_TYPE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Asset Types' },
  { value: 'workstation', label: 'Workstation' },
  { value: 'network_device', label: 'Network Device' },
  { value: 'server', label: 'Server' },
  { value: 'mobile_device', label: 'Mobile Device' },
  { value: 'printer', label: 'Printer' }
];

const ClientAssets: React.FC<ClientAssetsProps> = ({ clientId }) => {
  const [summary, setSummary] = useState<ClientMaintenanceSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
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
      setDrawerError('Unable to load asset details right now. Please try again.');
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
      default:
        return <Boxes {...iconProps} />;
    }
  };

  const loadData = async () => {
    try {
      const [summaryData, assetsData] = await Promise.all([
        getClientMaintenanceSummary(clientId),
        listAssets({
          client_id: clientId,
          asset_type: selectedType === 'all' ? undefined : (selectedType as AssetType),
          page: currentPage,
          limit: pageSize
        })
      ]);
      setSummary(summaryData);
      setAssets(assetsData.assets);
      setTotalItems(assetsData.total);
    } catch (error) {
      console.error('Error loading asset data:', error);
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

  const renderAssetDetails = (asset: Asset): string => {
    if (asset.workstation) {
      return `${asset.workstation.os_type} - ${asset.workstation.cpu_model} - ${asset.workstation.ram_gb}GB RAM`;
    }
    if (asset.network_device) {
      return `${asset.network_device.device_type} - ${asset.network_device.management_ip || 'No IP'}`;
    }
    if (asset.server) {
      return `${asset.server.os_type} - ${asset.server.cpu_model} - ${asset.server.ram_gb}GB RAM`;
    }
    if (asset.mobile_device) {
      return `${asset.mobile_device.os_type} - ${asset.mobile_device.model}`;
    }
    if (asset.printer) {
      return `${asset.printer.model} - ${asset.printer.is_network_printer ? 'Network' : 'Local'}`;
    }
    return 'No details available';
  };

  const columns = [
    {
      title: 'Asset Tag',
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
      title: 'Name',
      dataIndex: 'name',
      render: (value: string) => (
        <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{value}</span>
      )
    },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 dark:bg-[rgb(var(--color-border-50))] rounded-lg border border-gray-100 dark:border-[rgb(var(--color-border-200))]">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-700))]">
            {value.split('_').map((word: string): string => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
          </span>
        </div>
      )
    },
    {
      title: 'Details',
      dataIndex: 'details',
      render: (_: unknown, record: Asset): string => renderAssetDetails(record)
    },
    {
      title: 'Serial Number',
      dataIndex: 'serial_number',
      render: (value: string | null) => (
        <span className="font-mono text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
    {
      title: 'Status',
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
      title: 'Location',
      dataIndex: 'location',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
    {
      title: 'Purchase Date',
      dataIndex: 'purchase_date',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">
          {value ? new Date(value).toLocaleDateString() : '—'}
        </span>
      )
    },
    {
      title: 'Warranty End',
      dataIndex: 'warranty_end_date',
      render: (value: string | null) => {
        if (!value) return <span className="text-sm text-gray-400 dark:text-[rgb(var(--color-text-400))]">—</span>;
        const date = new Date(value);
        const isExpired = date < new Date();
        return (
          <span className={`text-sm font-medium ${isExpired ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-[rgb(var(--color-text-600))]'}`}>
            {date.toLocaleDateString()}
            {isExpired && <span className="ml-1 text-xs">(Expired)</span>}
          </span>
        );
      }
    }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Spinner size="lg" />
          <div className="space-y-1">
            <p className="text-lg font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">Loading assets...</p>
            <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">Please wait while we fetch your data</p>
          </div>
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
              <span className="text-xs font-medium text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-2.5 py-1 rounded-full">Active</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900/60 dark:text-blue-300/80">Total Assets</p>
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
              <p className="text-sm font-medium text-emerald-900/60 dark:text-emerald-300/80">Maintenance Rate</p>
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
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-2.5 py-1 rounded-full">Needs attention</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900/60 dark:text-amber-300/80">Overdue Maintenance</p>
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
              <span className="text-xs font-medium text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/50 px-2.5 py-1 rounded-full">Scheduled</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-violet-900/60 dark:text-violet-300/80">Upcoming Maintenance</p>
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
              Filter by Type
            </label>
            <CustomSelect
              options={ASSET_TYPE_OPTIONS}
              value={selectedType}
              onValueChange={setSelectedType}
              placeholder="All asset types..."
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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">Asset Inventory</h2>
          <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))] mt-1">Manage and track all client assets</p>
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">Maintenance Types</h3>
                <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">Breakdown by category</p>
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
              <h3 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">Asset Overview</h3>
              <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">Maintenance statistics</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-[rgb(var(--color-text-600))]">Assets with Maintenance</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))] mt-1">{summary?.assets_with_maintenance || 0}</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
                <p className="text-xs font-medium text-gray-500 dark:text-[rgb(var(--color-text-500))] uppercase tracking-wide mb-1">Total Schedules</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{summary?.total_schedules || 0}</p>
              </div>

              <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
                <p className="text-xs font-medium text-gray-500 dark:text-[rgb(var(--color-text-500))] uppercase tracking-wide mb-1">Coverage Rate</p>
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
