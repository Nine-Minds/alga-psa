'use client';

import { useState, useEffect } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { Card } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Asset, AssetListResponse, ClientMaintenanceSummary } from 'server/src/interfaces/asset.interfaces';
import { getClientMaintenanceSummary, listAssets } from 'server/src/lib/actions/asset-actions/assetActions';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QuickAddAsset } from './QuickAddAsset';
import {
  Monitor,
  Server,
  Smartphone,
  Printer,
  Network,
  Boxes,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp
} from 'lucide-react';

interface AssetDashboardProps {
  initialAssets: AssetListResponse;
}

export default function AssetDashboard({ initialAssets }: AssetDashboardProps) {
  const updateDashboard = useRegisterUIComponent({
    id: 'asset-dashboard',
    type: 'container',
    label: 'Asset Dashboard'
  });
  const [assets, setAssets] = useState<Asset[]>(initialAssets.assets);
  const [maintenanceSummaries, setMaintenanceSummaries] = useState<Record<string, ClientMaintenanceSummary>>({});
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Group assets by client
  const assetsByClient = assets.reduce((acc, asset) => {
    if (!asset.client_id) return acc;
    if (!acc[asset.client_id]) {
      acc[asset.client_id] = [];
    }
    acc[asset.client_id].push(asset);
    return acc;
  }, {} as Record<string, Asset[]>);

  // Calculate overall statistics
  const totalAssets = assets.length;
  const assetsByStatus = assets.reduce((acc, asset) => {
    acc[asset.status] = (acc[asset.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  useEffect(() => {
    async function loadMaintenanceSummaries() {
      setLoading(true);
      try {
        const summaries: Record<string, ClientMaintenanceSummary> = {};
        for (const clientId of Object.keys(assetsByClient)) {
          const summary = await getClientMaintenanceSummary(clientId);
          summaries[clientId] = summary;
        }
        setMaintenanceSummaries(summaries);
      } catch (error) {
        console.error('Error loading maintenance summaries:', error);
      }
      setLoading(false);
    }

    loadMaintenanceSummaries();
  }, []);

  // Calculate maintenance statistics
  const maintenanceStats = Object.values(maintenanceSummaries).reduce(
    (acc, summary) => {
      acc.totalSchedules += summary.total_schedules;
      acc.overdueMaintenances += summary.overdue_maintenances;
      acc.upcomingMaintenances += summary.upcoming_maintenances;
      return acc;
    },
    { totalSchedules: 0, overdueMaintenances: 0, upcomingMaintenances: 0 }
  );

  const getAssetTypeIcon = (type: string) => {
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

  const handleAssetAdded = async () => {
    try {
      const response = await listAssets({});
      setAssets(response.assets);
    } catch (error) {
      console.error('Error reloading assets:', error);
    }
    router.refresh();
  };

  const columns: ColumnDefinition<Asset>[] = [
    {
      dataIndex: 'name',
      title: 'Name',
      render: (value: unknown, record: Asset) => (
        <Link
          href={`/msp/assets/${record.asset_id}`}
          className="font-medium text-primary-600 hover:text-primary-700 hover:underline transition-colors"
        >
          {record.name}
        </Link>
      )
    },
    {
      dataIndex: 'asset_tag',
      title: 'Tag',
      render: (value: unknown) => (
        <span className="font-mono text-sm text-gray-600">{value as string}</span>
      )
    },
    {
      dataIndex: 'asset_type',
      title: 'Type',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700">
            {value.split('_').map((word):string => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
          </span>
        </div>
      )
    },
    {
      dataIndex: 'details',
      title: 'Details',
      render: (_: unknown, record: Asset) => (
        <span className="text-sm text-gray-600">{renderAssetDetails(record)}</span>
      )
    },
    {
      dataIndex: 'status',
      title: 'Status',
      render: (value: unknown) => {
        const status = value as string;
        return (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
            status === 'active'
              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20'
              : status === 'inactive'
              ? 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20'
              : 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
              status === 'active' ? 'bg-emerald-500' : status === 'inactive' ? 'bg-gray-500' : 'bg-amber-500'
            }`}></span>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        );
      }
    },
    {
      dataIndex: 'client_name',
      title: 'Client',
      render: (_: unknown, record: Asset) => (
        <span className="text-sm font-medium text-gray-700">
          {record.client?.client_name || 'Unassigned'}
        </span>
      )
    },
    {
      dataIndex: 'location',
      title: 'Location',
      render: (value: unknown) => (
        <span className="text-sm text-gray-600">{(value as string) || '—'}</span>
      )
    }
  ];

  return (
    <div className="space-y-8 p-6">
      {/* Header with Add Asset Button */}
      <div {...withDataAutomationId({ id: 'asset-dashboard-header' })} className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Asset Management</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage all client assets</p>
        </div>
        <div {...withDataAutomationId({ id: 'quick-add-asset-wrapper' })}>
          <QuickAddAsset onAssetAdded={handleAssetAdded} />
        </div>
      </div>

      {/* Overview Section - Redesigned with gradients */}
      <div {...withDataAutomationId({ id: 'asset-overview-section' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Assets Card */}
        <div {...withDataAutomationId({ id: 'total-assets-card' })} className="group relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-blue-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-blue-500/10 rounded-lg ring-1 ring-blue-500/20">
                <Boxes className="h-6 w-6 text-blue-600" />
              </div>
              <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2.5 py-1 rounded-full">Total</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900/60">Total Assets</p>
              <p className="text-3xl font-bold text-blue-900">{totalAssets}</p>
            </div>
          </div>
        </div>

        {/* Maintenance Schedules Card */}
        <div {...withDataAutomationId({ id: 'maintenance-schedules-card' })} className="group relative overflow-hidden bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-emerald-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-emerald-500/10 rounded-lg ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-emerald-900/60">Active Schedules</p>
              <p className="text-3xl font-bold text-emerald-900">{maintenanceStats.totalSchedules}</p>
            </div>
          </div>
        </div>

        {/* Overdue Maintenance Card */}
        <div {...withDataAutomationId({ id: 'overdue-maintenance-card' })} className="group relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-amber-100/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500"></div>
          <div className="relative p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-amber-500/10 rounded-lg ring-1 ring-amber-500/20">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              {maintenanceStats.overdueMaintenances > 0 && (
                <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">Action needed</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900/60">Overdue Maintenance</p>
              <p className="text-3xl font-bold text-amber-900">{maintenanceStats.overdueMaintenances}</p>
            </div>
          </div>
        </div>

        {/* Upcoming Maintenance Card */}
        <div {...withDataAutomationId({ id: 'upcoming-maintenance-card' })} className="group relative overflow-hidden bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-violet-100/50">
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
              <p className="text-3xl font-bold text-violet-900">{maintenanceStats.upcomingMaintenances}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Status Distribution */}
      <div {...withDataAutomationId({ id: 'asset-status-distribution' })} className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Boxes className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Asset Status Distribution</h3>
            <p className="text-sm text-gray-500">Overview by status</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(assetsByStatus).map(([status, count]): JSX.Element => (
            <div
              {...withDataAutomationId({ id: `status-count-${status}` })}
              key={status}
              className="bg-white rounded-lg p-5 border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all"
            >
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 capitalize">{status}</p>
              <p className="text-3xl font-bold text-gray-900">{count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Client Assets Overview */}
      <div {...withDataAutomationId({ id: 'client-assets-overview' })} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Boxes className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Assets by Client</h3>
            <p className="text-sm text-gray-500">Client asset breakdown with maintenance status</p>
          </div>
        </div>
        <div className="space-y-4">
          {Object.entries(assetsByClient).map(([clientId, clientAssets]): JSX.Element => {
            const summary = maintenanceSummaries[clientId];
            const clientName = clientAssets[0]?.client?.client_name || 'Unassigned';
            return (
              <div
                {...withDataAutomationId({ id: `client-assets-${clientId}` })}
                key={clientId}
                className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-all"
              >
                <div {...withDataAutomationId({ id: `client-header-${clientId}` })} className="flex justify-between items-center mb-4">
                  <h4 className="text-lg font-semibold text-gray-900">
                    {clientName}
                  </h4>
                  <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                    {clientAssets.length} {clientAssets.length === 1 ? 'asset' : 'assets'}
                  </span>
                </div>
                {summary && (
                  <div {...withDataAutomationId({ id: `client-maintenance-stats-${clientId}` })} className="grid grid-cols-3 gap-4">
                    <div {...withDataAutomationId({ id: `client-compliance-${clientId}` })} className="bg-white rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">Compliance</p>
                      <p className="text-xl font-bold text-emerald-600">
                        {summary.compliance_rate.toFixed(1)}%
                      </p>
                    </div>
                    <div {...withDataAutomationId({ id: `client-overdue-${clientId}` })} className="bg-white rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">Overdue</p>
                      <p className="text-xl font-bold text-amber-600">
                        {summary.overdue_maintenances}
                      </p>
                    </div>
                    <div {...withDataAutomationId({ id: `client-upcoming-${clientId}` })} className="bg-white rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">Upcoming</p>
                      <p className="text-xl font-bold text-violet-600">
                        {summary.upcoming_maintenances}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Assets Table */}
      <div {...withDataAutomationId({ id: 'recent-assets-table-card' })} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-xl font-semibold text-gray-900">Recent Assets</h3>
          <p className="text-sm text-gray-500 mt-1">Latest asset additions and updates</p>
        </div>
        <div className="p-6">
          <DataTable
            {...withDataAutomationId({ id: 'recent-assets-table' })}
            columns={columns.map((col): ColumnDefinition<Asset> => ({
              ...col,
              render: col.render ?
                (value: unknown, record: Asset, index: number) => (
                  <div {...withDataAutomationId({ id: `asset-${record.asset_id}-${col.dataIndex}` })}>
                    {col.render(value, record, index)}
                  </div>
                ) : undefined
            }))}
            data={assets.slice(0, 5).map((asset):Asset => ({
              ...asset,
              asset_id: asset.asset_id // Add id property for unique keys
            }))}
            pagination={false}
            onRowClick={(asset) => router.push(`/msp/assets/${asset.asset_id}`)}
          />
        </div>
      </div>

      {loading && (
        <div {...withDataAutomationId({ id: 'loading-overlay' })} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-sm mx-4">
            <div className="text-center space-y-4">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold text-gray-900">Loading maintenance data...</p>
                <p className="text-sm text-gray-500">Please wait while we fetch the information</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
