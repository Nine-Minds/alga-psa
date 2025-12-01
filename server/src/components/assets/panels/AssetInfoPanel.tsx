import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Stack, Text, Group, ActionIcon, CopyButton, Tooltip } from '@mantine/core';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { Asset } from '../../../interfaces/asset.interfaces';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';
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
    <Group justify="space-between" align="flex-start" className="py-2 border-b last:border-0 border-gray-100 dark:border-gray-800">
      <Text size="sm" c="dimmed">{label}</Text>
      <div className="text-right">
        {link ? (
          <Link href={link} className="text-primary-600 hover:underline flex items-center justify-end gap-1">
            <Text size="sm" fw={500}>{value}</Text>
            <ExternalLink size={12} />
          </Link>
        ) : (
          <Group gap={4} justify="flex-end">
            <Text size="sm" fw={500}>{value}</Text>
            {copyable && typeof value === 'string' && (
              <CopyButton value={value} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="left">
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

  return (
    <Card title="Asset Info & Lifecycle">
      <div className="flex flex-col">
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
          value={
            asset.workstation?.cpu_model || 
            asset.server?.cpu_model || 
            asset.mobile_device?.model || 
            asset.printer?.model || 
            asset.network_device?.device_type || 
            'Unknown Model'
          } 
        />
        <InfoRow 
          label="Serial Number" 
          value={asset.serial_number || 'N/A'} 
          copyable={!!asset.serial_number}
        />
        <InfoRow 
          label="Purchase Date" 
          value={asset.purchase_date ? formatDateTime(new Date(asset.purchase_date), Intl.DateTimeFormat().resolvedOptions().timeZone).split(' ')[0] : 'N/A'} 
        />
        <InfoRow 
          label="Warranty End" 
          value={asset.warranty_end_date ? formatDateTime(new Date(asset.warranty_end_date), Intl.DateTimeFormat().resolvedOptions().timeZone).split(' ')[0] : 'N/A'} 
        />
      </div>
    </Card>
  );
};