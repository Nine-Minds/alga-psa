'use client';

import { Asset, type AssetStatusKind } from '@alga-psa/types';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { PlusCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { portalAssetStatusLabel, portalAssetStatusVariant } from './portalAssetStatus';

// Extension numerics are nullable ("unknown", never 0) — show that instead of a bare "null cores".
const formatCpu = (model: string | null | undefined, cores: number | null | undefined): string => {
  const trimmedModel = model?.trim() ?? '';
  if (cores == null) return trimmedModel || 'Not provided';
  return trimmedModel ? `${trimmedModel} (${cores} cores)` : `${cores} cores`;
};

interface AssetDetailsProps {
  asset: Asset;
  /** The tenant's label for the asset's status, when the caller knows it. */
  statusLabel?: string;
  /** The status's lifecycle kind, which the badge tone follows. */
  statusKind?: AssetStatusKind;
  onCreateTicket?: (asset: Asset) => void;
}

export function AssetDetails({ asset, statusLabel, statusKind, onCreateTicket }: AssetDetailsProps) {
  const { t } = useTranslation('client-portal');
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
              <p className="mt-1">{formatCpu(asset.workstation.cpu_model, asset.workstation.cpu_cores)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">RAM</p>
              <p className="mt-1">{asset.workstation.ram_gb != null ? `${asset.workstation.ram_gb}GB` : 'Not provided'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Storage</p>
              <p className="mt-1">{asset.workstation.storage_capacity_gb != null ? `${asset.workstation.storage_type} ${asset.workstation.storage_capacity_gb}GB` : (asset.workstation.storage_type || 'Not provided')}</p>
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
              <p className="mt-1">{asset.network_device.port_count ?? 'Not provided'}</p>
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
              <p className="mt-1">{formatCpu(asset.server.cpu_model, asset.server.cpu_cores)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">RAM</p>
              <p className="mt-1">{asset.server.ram_gb != null ? `${asset.server.ram_gb}GB` : 'Not provided'}</p>
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
              {/* A div, not a p: Badge renders a div, and a div inside a p is
                  invalid markup that React reports as a hydration error. */}
              <div className="mt-1">
                {/* A tenant's custom status must read as its label, never as
                    the "in_repair" slug the registry stores — and it must read
                    the same here as in the device list. */}
                <Badge variant={portalAssetStatusVariant(asset.status, statusKind)}>
                  {portalAssetStatusLabel(t, asset.status, statusLabel)}
                </Badge>
              </div>
            </div>
            <div>
              {/* FR-C6: contact name only — no assignment history, no cost. */}
              <p className="text-sm text-gray-500">
                {asset.group?.kind === 'shared_workspace'
                  ? t('assets.sharedWorkspaceLabel', 'Shared workspace')
                  : t('assets.columns.assignedTo', 'Assigned to')}
              </p>
              <p className="mt-1">
                {asset.group?.kind === 'shared_workspace'
                  ? asset.group.name
                  : asset.contact_name || t('assets.unassigned', 'Unassigned')}
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

      {/* Extension Data — only render the card when we actually have type-specific details. */}
      {renderExtensionData() && (
        <Card>
          <div className="p-4">{renderExtensionData()}</div>
        </Card>
      )}

      {onCreateTicket && (
        <div className="flex justify-end">
          <Button
            id="asset-details-create-ticket"
            variant="default"
            onClick={() => onCreateTicket(asset)}
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            {t('devices.createTicket', 'Create ticket')}
          </Button>
        </div>
      )}
    </div>
  );
}
