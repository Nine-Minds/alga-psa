import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { Asset } from '../../../interfaces/asset.interfaces';
import { formatDateOnly } from '../../../lib/utils/dateTimeUtils';
import Link from 'next/link';
import { cn } from 'server/src/lib/utils';
import { useDrawer } from 'server/src/context/DrawerContext';
import { ClientQuickView } from '../../clients/ClientQuickView';

interface AssetInfoPanelProps {
  asset: Asset;
  isLoading: boolean;
}

const InfoRow = ({ 
  label, 
  value, 
  copyable = false, 
  link = null,
  onClick = null
}: { 
  label: string, 
  value: React.ReactNode, 
  copyable?: boolean, 
  link?: string | null,
  onClick?: (() => void) | null
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof value === 'string') {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const content = (
    <div className="flex items-start gap-2 min-h-[24px]">
      <span className="text-sm font-bold text-gray-700 w-32 shrink-0">{label}:</span>
      <div className="flex-1 flex items-center gap-2">
        {onClick ? (
          <button 
            type="button"
            onClick={onClick} 
            className="text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1 text-left"
          >
            <span className="text-sm">{value}</span>
            <ExternalLink size={12} />
          </button>
        ) : link ? (
          <Link href={link} className="text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1">
            <span className="text-sm">{value}</span>
            <ExternalLink size={12} />
          </Link>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-900">{value}</span>
            {copyable && typeof value === 'string' && (
              <Tooltip content={copied ? 'Copied' : 'Copy'}>
                <Button
                  id={`copy-${label.toLowerCase().replace(/\s+/g, '-')}`}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-5 w-5 p-0",
                    copied ? "text-emerald-500" : "text-gray-400 hover:text-gray-600"
                  )}
                  onClick={handleCopy}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </Button>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return content;
};

export const AssetInfoPanel: React.FC<AssetInfoPanelProps> = ({
  asset,
  isLoading
}) => {
  const { openDrawer } = useDrawer();

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  const handleOpenClientDrawer = () => {
    if (asset.client_id) {
      openDrawer(<ClientQuickView clientId={asset.client_id} />);
    }
  };

  const getModelName = () => {
    // Try to get model from system_info if available
    const workstationModel = (asset.workstation?.system_info as any)?.model || (asset.workstation?.system_info as any)?.systemModel;
    const serverModel = (asset.server?.system_info as any)?.model || (asset.server?.system_info as any)?.systemModel;

    return workstationModel || 
           serverModel || 
           asset.mobile_device?.model || 
           asset.printer?.model || 
           asset.network_device?.device_type || 
           asset.workstation?.cpu_model || // Fallback to CPU if model unknown
           asset.server?.cpu_model ||
           'Unknown Model';
  };

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>Asset Info & Lifecycle</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <InfoRow 
            label="Client" 
            value={asset.client?.client_name || 'Unknown Client'} 
            onClick={handleOpenClientDrawer}
          />
          <InfoRow 
            label="Location" 
            value={asset.location || 'Unassigned'} 
          />
          <InfoRow 
            label="Model" 
            value={getModelName()} 
          />
          <InfoRow 
            label="Serial Number" 
            value={asset.serial_number || 'N/A'} 
            copyable={!!asset.serial_number}
          />
          <InfoRow 
            label="Purchase Date" 
            value={asset.purchase_date ? formatDateOnly(new Date(asset.purchase_date)) : 'N/A'} 
          />
          <InfoRow 
            label="Warranty End" 
            value={asset.warranty_end_date ? formatDateOnly(new Date(asset.warranty_end_date)) : 'N/A'} 
          />
        </div>
      </CardContent>
    </Card>
  );
};