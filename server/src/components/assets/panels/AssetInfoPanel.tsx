import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Group, Text, ActionIcon, CopyButton, Tooltip } from '@mantine/core';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { Asset } from '../../../interfaces/asset.interfaces';
import { formatDateOnly } from '../../../lib/utils/dateTimeUtils';
import Link from 'next/link';

interface AssetInfoPanelProps {
  asset: Asset;
  isLoading: boolean;
}

export const AssetInfoPanel: React.FC<AssetInfoPanelProps> = ({
  asset,
  isLoading
}) => {
  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  const InfoRow = ({ label, value, copyable = false, link = null }: { label: string, value: React.ReactNode, copyable?: boolean, link?: string | null }) => (
    <Group gap="xs" align="flex-start" className="min-h-[24px]">
      <Text size="sm" fw={700} className="w-32 shrink-0">{label}:</Text>
      <div className="flex-1 flex items-center gap-2">
        {link ? (
          <Link href={link} className="text-primary-600 hover:underline flex items-center gap-1">
            <Text size="sm">{value}</Text>
            <ExternalLink size={12} />
          </Link>
        ) : (
          <Group gap={4}>
            <Text size="sm">{value}</Text>
            {copyable && typeof value === 'string' && (
              <CopyButton value={value} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                    <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} size="xs">
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            )}
          </Group>
        )}
      </div>
    </Group>
  );

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
            link={asset.client ? `/clients/${asset.client.client_id}` : null}
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