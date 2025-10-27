'use client';

import React, { useState, useEffect } from 'react';
import { ClientMaintenanceSummary, Asset } from 'server/src/interfaces/asset.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import { getClientMaintenanceSummary, listAssets } from '@product/actions/asset-actions/assetActions';
import {
  Boxes,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Monitor,
  Server,
  Smartphone,
  Printer,
  Network
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
  const router = useRouter();
  const pageSize = 10;

  const getAssetTypeIcon = (type: string): JSX.Element => {
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
          className="text-primary-600 hover:text-primary-700"
          prefetch={false}
        >
          {value}
        </Link>
      )
    },
    {
      title: 'Name',
      dataIndex: 'name'
    },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      render: (value: string) => (
        <div className="flex items-center">
          {getAssetTypeIcon(value)}
          <span>{value.split('_').map((word: string): string => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</span>
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
      render: (value: string | null) => value || '-'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
          value === 'active'
            ? 'bg-green-100 text-green-800'
            : value === 'inactive'
            ? 'bg-gray-100 text-gray-800'
            : 'bg-amber-100 text-amber-800'
        }`}>
          {value}
        </span>
      )
    },
    {
      title: 'Location',
      dataIndex: 'location',
      render: (value: string | null) => value || '-'
    },
    {
      title: 'Purchase Date',
      dataIndex: 'purchase_date',
      render: (value: string | null) => value ? new Date(value).toLocaleDateString() : '-'
    },
    {
      title: 'Warranty End',
      dataIndex: 'warranty_end_date',
      render: (value: string | null) => {
        if (!value) return '-';
        const date = new Date(value);
        const isExpired = date < new Date();
        return (
          <span className={isExpired ? 'text-red-600' : 'text-gray-900'}>
            {date.toLocaleDateString()}
          </span>
        );
      }
    }
  ];

  if (isLoading) {
    return <div>Loading assets...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Assets</p>
              <p className="text-2xl font-semibold">{summary?.total_assets || 0}</p>
            </div>
            <Boxes className="h-8 w-8 text-primary-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Maintenance Rate</p>
              <p className="text-2xl font-semibold">
                {Math.round(summary?.compliance_rate || 0)}%
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Overdue</p>
              <p className="text-2xl font-semibold">{summary?.overdue_maintenances || 0}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-amber-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Upcoming</p>
              <p className="text-2xl font-semibold">{summary?.upcoming_maintenances || 0}</p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Actions and Filters */}
      <div className="flex justify-between items-center">
        <div className="w-64">
          <CustomSelect
            options={ASSET_TYPE_OPTIONS}
            value={selectedType}
            onValueChange={setSelectedType}
            placeholder="Filter by type..."
          />
        </div>
        <QuickAddAsset
          clientId={clientId}
          onAssetAdded={handleAssetAdded}
        />
      </div>

      {/* Assets Table */}
      <DataTable
        data={assets}
        columns={columns}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onRowClick={(asset: Asset) => router.push(`/msp/assets/${asset.asset_id}`)}
        totalItems={totalItems}
        pageSize={pageSize}
      />

      {/* Maintenance Type Breakdown */}
      {summary?.maintenance_by_type && Object.keys(summary.maintenance_by_type).length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Maintenance Types</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(summary.maintenance_by_type).map(([type, count]): JSX.Element => (
              <div key={type} className="text-center">
                <p className="text-sm text-gray-500 capitalize">{type}</p>
                <p className="text-xl font-semibold">{count}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Asset Stats */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Asset Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-500">Assets with Maintenance</p>
            <p className="text-xl font-semibold">{summary?.assets_with_maintenance || 0}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Schedules</p>
            <p className="text-xl font-semibold">{summary?.total_schedules || 0}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Active Maintenance Plans</p>
            <p className="text-xl font-semibold">
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
  );
};

export default ClientAssets;
