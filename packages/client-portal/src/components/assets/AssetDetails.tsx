'use client';

import { Asset } from '@alga-psa/types';
import { Card } from '@alga-psa/ui/components/Card';

interface AssetDetailsProps {
  asset: Asset;
}

export function AssetDetails({ asset }: AssetDetailsProps) {
  // Helper function to format dates
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Helper function to render extension data
  const renderExtensionData = () => {
    if (asset.workstation) {
      return (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-500">Workstation Details</h3>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">OS</p>
              <p className="mt-1">{asset.workstation.os_type} {asset.workstation.os_version}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">CPU</p>
              <p className="mt-1">{asset.workstation.cpu_model} ({asset.workstation.cpu_cores} cores)</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">RAM</p>
              <p className="mt-1">{asset.workstation.ram_gb}GB</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Storage</p>
              <p className="mt-1">{asset.workstation.storage_type} {asset.workstation.storage_capacity_gb}GB</p>
            </div>
          </div>
        </div>
      );
    }

    if (asset.network_device) {
      return (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-500">Network Device Details</h3>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Device Type</p>
              <p className="mt-1">{asset.network_device.device_type}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">IP Address</p>
              <p className="mt-1">{asset.network_device.management_ip}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Ports</p>
              <p className="mt-1">{asset.network_device.port_count}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Firmware</p>
              <p className="mt-1">{asset.network_device.firmware_version}</p>
            </div>
          </div>
        </div>
      );
    }

    if (asset.server) {
      return (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-500">Server Details</h3>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">OS</p>
              <p className="mt-1">{asset.server.os_type} {asset.server.os_version}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">CPU</p>
              <p className="mt-1">{asset.server.cpu_model} ({asset.server.cpu_cores} cores)</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">RAM</p>
              <p className="mt-1">{asset.server.ram_gb}GB</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Type</p>
              <p className="mt-1">{asset.server.is_virtual ? 'Virtual' : 'Physical'}</p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6 p-4">
      {/* Basic Information */}
      <Card>
        <div className="p-4">
          <h2 className="text-lg font-medium text-gray-900">Basic Information</h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Asset Tag</p>
              <p className="mt-1">{asset.asset_tag}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Serial Number</p>
              <p className="mt-1">{asset.serial_number || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  asset.status === 'active' ? 'bg-green-100 text-green-800' :
                  asset.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {asset.status}
                </span>
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Location</p>
              <p className="mt-1">{asset.location || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Purchase Date</p>
              <p className="mt-1">{formatDate(asset.purchase_date)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Warranty End Date</p>
              <p className="mt-1">{formatDate(asset.warranty_end_date)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Extension Data */}
      <Card>
        <div className="p-4">
          {renderExtensionData()}
        </div>
      </Card>
    </div>
  );
}
