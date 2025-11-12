'use client';

import React, { useState, useEffect } from 'react';
import { ClientMaintenanceSummary, Asset } from 'server/src/interfaces/asset.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import { getClientMaintenanceSummary, listAssets } from 'server/src/lib/actions/asset-actions/assetActions';
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
import { useRouter } from 'next/navigation';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { QuickAddAsset } from 'server/src/components/assets/QuickAddAsset';

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
  const router = useRouter();

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const getAssetTypeIcon = (type: string): JSX.Element => {
    const iconProps = { className: "h-4 w-4 text-gray-600" };
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
        <span className="font-medium text-gray-900">{value}</span>
      )
    },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700">
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
        <span className="font-mono text-sm text-gray-600">{value || '—'}</span>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
          value === 'active'
            ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20'
            : value === 'inactive'
            ? 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20'
            : 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
            value === 'active' ? 'bg-emerald-500' : value === 'inactive' ? 'bg-gray-500' : 'bg-amber-500'
          }`}></span>
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </span>
      )
    },
    {
      title: 'Location',
      dataIndex: 'location',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600">{value || '—'}</span>
      )
    },
    {
      title: 'Purchase Date',
      dataIndex: 'purchase_date',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600">
          {value ? new Date(value).toLocaleDateString() : '—'}
        </span>
      )
    },
    {
      title: 'Warranty End',
      dataIndex: 'warranty_end_date',
      render: (value: string | null) => {
        if (!value) return <span className="text-sm text-gray-400">—</span>;
        const date = new Date(value);
        const isExpired = date < new Date();
        return (
          <span className={`text-sm font-medium ${isExpired ? 'text-red-600' : 'text-gray-600'}`}>
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
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium text-gray-900">Loading assets...</p>
            <p className="text-sm text-gray-500">Please wait while we fetch your data</p>
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
        <div className="group relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-blue-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-blue-500/10 rounded-lg ring-1 ring-blue-500/20">
                <Boxes className="h-6 w-6 text-blue-600" />
              </div>
              <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2.5 py-1 rounded-full">Active</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900/60">Total Assets</p>
              <p className="text-3xl font-bold text-blue-900">{summary?.total_assets || 0}</p>
            </div>
          </div>
        </div>

        {/* Maintenance Rate Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-emerald-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-emerald-500/10 rounded-lg ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-emerald-900/60">Maintenance Rate</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold text-emerald-900">
                  {Math.round(summary?.compliance_rate || 0)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Overdue Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-amber-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-amber-500/10 rounded-lg ring-1 ring-amber-500/20">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              {(summary?.overdue_maintenances || 0) > 0 && (
                <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">Needs attention</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900/60">Overdue Maintenance</p>
              <p className="text-3xl font-bold text-amber-900">{summary?.overdue_maintenances || 0}</p>
            </div>
          </div>
        </div>

        {/* Upcoming Card */}
        <div className="group relative overflow-hidden bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-violet-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-violet-500/10 rounded-lg ring-1 ring-violet-500/20">
                <Clock className="h-6 w-6 text-violet-600" />
              </div>
              <span className="text-xs font-medium text-violet-600 bg-violet-100 px-2.5 py-1 rounded-full">Scheduled</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-violet-900/60">Upcoming Maintenance</p>
              <p className="text-3xl font-bold text-violet-900">{summary?.upcoming_maintenances || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions and Filters - Improved layout */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Asset Inventory</h2>
          <p className="text-sm text-gray-500 mt-1">Manage and track all client assets</p>
        </div>
        <DataTable
          id="client-assets-table"
          data={assets}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onRowClick={(asset: Asset) => router.push(`/msp/assets/${asset.asset_id}`)}
          totalItems={totalItems}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </div>

      {/* Bottom Grid - Maintenance Type Breakdown and Asset Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Maintenance Type Breakdown */}
        {summary?.maintenance_by_type && Object.keys(summary.maintenance_by_type).length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-slate-100 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Maintenance Types</h3>
                <p className="text-sm text-gray-500">Breakdown by category</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(summary.maintenance_by_type).map(([type, count]): JSX.Element => (
                <div key={type} className="bg-white rounded-lg p-4 border border-gray-100 hover:border-gray-200 transition-colors">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{type}</p>
                  <p className="text-2xl font-bold text-gray-900">{count}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Asset Stats */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border border-blue-100 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Boxes className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Asset Overview</h3>
              <p className="text-sm text-gray-500">Maintenance statistics</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-blue-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Assets with Maintenance</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{summary?.assets_with_maintenance || 0}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Schedules</p>
                <p className="text-2xl font-bold text-gray-900">{summary?.total_schedules || 0}</p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Coverage Rate</p>
                <p className="text-2xl font-bold text-gray-900">
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
    </div>
  );
};

export default ClientAssets;
