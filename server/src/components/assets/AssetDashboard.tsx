'use client';

import { useState, useEffect } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { Card } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Asset, AssetListResponse, ClientMaintenanceSummary } from 'server/src/interfaces/asset.interfaces';
import { getClientMaintenanceSummary, listAssets } from '@product/actions/asset-actions/assetActions';
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
  Boxes
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
    const iconProps = { className: "h-5 w-5 inline-block mr-2" };
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
          className="text-primary-600 hover:text-primary-700"
        >
          {record.name}
        </Link>
      )
    },
    { 
      dataIndex: 'asset_tag',
      title: 'Tag'
    },
    {
      dataIndex: 'asset_type',
      title: 'Type',
      render: (value: string) => (
        <div className="flex items-center">
          {getAssetTypeIcon(value)}
          <span>{value.split('_').map((word):string => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</span>
        </div>
      )
    },
    {
      dataIndex: 'details',
      title: 'Details',
      render: (_: unknown, record: Asset) => renderAssetDetails(record)
    },
    { 
      dataIndex: 'status',
      title: 'Status',
      render: (value: unknown) => {
        const status = value as string;
        return (
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            status === 'active' ? 'bg-green-100 text-green-800' :
            status === 'inactive' ? 'bg-gray-100 text-gray-800' :
            'bg-amber-100 text-amber-800'
          }`}>
            {status}
          </span>
        );
      }
    },
    { 
      dataIndex: 'client_name',
      title: 'Client',
      render: (_: unknown, record: Asset) => record.client?.client_name || 'Unassigned'
    },
    {
      dataIndex: 'location',
      title: 'Location',
      render: (value: unknown) => (value as string) || 'Not specified'
    }
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header with Add Asset Button */}
      <div {...withDataAutomationId({ id: 'asset-dashboard-header' })} className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">Assets</h1>
        <div {...withDataAutomationId({ id: 'quick-add-asset-wrapper' })}>
          <QuickAddAsset onAssetAdded={handleAssetAdded} />
        </div>
      </div>

      {/* Overview Section */}
      <div {...withDataAutomationId({ id: 'asset-overview-section' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card {...withDataAutomationId({ id: 'total-assets-card' })} className="p-4 border border-[rgb(var(--color-border-200))]">
          <h3 className="text-lg font-semibold mb-2 text-[rgb(var(--color-text-900))]">Total Assets</h3>
          <p className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{totalAssets}</p>
        </Card>
        
        <Card {...withDataAutomationId({ id: 'maintenance-schedules-card' })} className="p-4 border border-[rgb(var(--color-border-200))]">
          <h3 className="text-lg font-semibold mb-2 text-[rgb(var(--color-text-900))]">Maintenance Schedules</h3>
          <p className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{maintenanceStats.totalSchedules}</p>
        </Card>
        
        <Card {...withDataAutomationId({ id: 'overdue-maintenance-card' })} className="p-4 border border-[rgb(var(--color-border-200))]">
          <h3 className="text-lg font-semibold mb-2 text-[rgb(var(--color-text-900))]">Overdue Maintenance</h3>
          <p className="text-3xl font-bold text-[rgb(var(--color-accent-500))]">
            {maintenanceStats.overdueMaintenances}
          </p>
        </Card>
        
        <Card {...withDataAutomationId({ id: 'upcoming-maintenance-card' })} className="p-4 border border-[rgb(var(--color-border-200))]">
          <h3 className="text-lg font-semibold mb-2 text-[rgb(var(--color-text-900))]">Upcoming Maintenance</h3>
          <p className="text-3xl font-bold text-[rgb(var(--color-primary-500))]">
            {maintenanceStats.upcomingMaintenances}
          </p>
        </Card>
      </div>

      {/* Status Distribution */}
      <Card {...withDataAutomationId({ id: 'asset-status-distribution' })} className="p-4 border border-[rgb(var(--color-border-200))]">
        <h3 className="text-xl font-semibold mb-4 text-[rgb(var(--color-text-900))]">Asset Status Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(assetsByStatus).map(([status, count]): JSX.Element => (
            <div 
              {...withDataAutomationId({ id: `status-count-${status}` })}
              key={status} 
              className="text-center p-4 rounded-lg bg-[rgb(var(--color-border-50))]"
            >
              <p className="text-lg font-medium text-[rgb(var(--color-text-700))]">{status}</p>
              <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{count}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Client Assets Overview */}
      <Card {...withDataAutomationId({ id: 'client-assets-overview' })} className="p-4 border border-[rgb(var(--color-border-200))]">
        <h3 className="text-xl font-semibold mb-4 text-[rgb(var(--color-text-900))]">Assets by Client</h3>
        <div className="space-y-4">
          {Object.entries(assetsByClient).map(([clientId, clientAssets]): JSX.Element => {
            const summary = maintenanceSummaries[clientId];
            const clientName = clientAssets[0]?.client?.client_name || 'Unassigned';
            return (
              <div 
                {...withDataAutomationId({ id: `client-assets-${clientId}` })}
                key={clientId} 
                className="border border-[rgb(var(--color-border-200))] rounded-lg p-4 bg-[rgb(var(--color-border-50))]"
              >
                <div {...withDataAutomationId({ id: `client-header-${clientId}` })} className="flex justify-between items-center mb-2">
                  <h4 className="text-lg font-medium text-[rgb(var(--color-text-900))]">
                    {clientName}
                  </h4>
                  <span className="text-sm text-[rgb(var(--color-text-600))]">
                    {clientAssets.length} assets
                  </span>
                </div>
                {summary && (
                  <div {...withDataAutomationId({ id: `client-maintenance-stats-${clientId}` })} className="grid grid-cols-3 gap-4 mt-2 text-sm">
                    <div {...withDataAutomationId({ id: `client-compliance-${clientId}` })}>
                      <p className="text-[rgb(var(--color-text-600))]">Maintenance Compliance</p>
                      <p className="font-semibold text-[rgb(var(--color-text-900))]">
                        {summary.compliance_rate.toFixed(1)}%
                      </p>
                    </div>
                    <div {...withDataAutomationId({ id: `client-overdue-${clientId}` })}>
                      <p className="text-[rgb(var(--color-text-600))]">Overdue</p>
                      <p className="font-semibold text-[rgb(var(--color-accent-500))]">
                        {summary.overdue_maintenances}
                      </p>
                    </div>
                    <div {...withDataAutomationId({ id: `client-upcoming-${clientId}` })}>
                      <p className="text-[rgb(var(--color-text-600))]">Upcoming</p>
                      <p className="font-semibold text-[rgb(var(--color-primary-500))]">
                        {summary.upcoming_maintenances}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recent Assets Table */}
      <Card {...withDataAutomationId({ id: 'recent-assets-table-card' })} className="p-4 border border-[rgb(var(--color-border-200))]">
        <h3 className="text-xl font-semibold mb-4 text-[rgb(var(--color-text-900))]">Recent Assets</h3>
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
      </Card>

      {loading && (
        <div {...withDataAutomationId({ id: 'loading-overlay' })} className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg text-[rgb(var(--color-text-900))]">
            Loading maintenance data...
          </div>
        </div>
      )}
    </div>
  );
}
