import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { ExternalLink, Copy, Check } from 'lucide-react';
import type { Asset } from '@alga-psa/types';
import { formatDateOnly } from '@alga-psa/core';
import Link from 'next/link';
import { cn, useClientDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetInfoPanelProps {
  asset: Asset;
  isLoading: boolean;
}

const InfoRow = ({ 
  label, 
  value, 
  copyable = false, 
  link = null,
  onClick = null,
  copyId,
  copyLabel,
  copiedLabel
}: { 
  label: string, 
  value: React.ReactNode, 
  copyable?: boolean, 
  link?: string | null,
  onClick?: (() => void) | null,
  copyId?: string,
  copyLabel?: string,
  copiedLabel?: string
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
              <Tooltip content={copied ? copiedLabel : copyLabel}>
                <Button
                  id={`copy-${copyId ?? 'value'}`}
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
  const { t } = useTranslation('msp/assets');
  const clientDrawer = useClientDrawer();

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  const handleOpenClientDrawer = () => {
    if (asset.client_id && clientDrawer) {
      clientDrawer.openClientDrawer(asset.client_id);
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
           t('assetInfoPanel.values.unknownModel', { defaultValue: 'Unknown Model' });
  };

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>{t('assetInfoPanel.title', { defaultValue: 'Asset Info & Lifecycle' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <InfoRow 
            label={t('assetInfoPanel.fields.client', { defaultValue: 'Client' })}
            value={asset.client?.client_name || t('assetInfoPanel.values.unknownClient', {
              defaultValue: 'Unknown Client'
            })}
            onClick={handleOpenClientDrawer}
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
          <InfoRow 
            label={t('assetInfoPanel.fields.location', { defaultValue: 'Location' })}
            value={asset.location || t('assetInfoPanel.values.unassigned', { defaultValue: 'Unassigned' })}
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
          <InfoRow 
            label={t('assetInfoPanel.fields.model', { defaultValue: 'Model' })}
            value={getModelName()} 
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
          <InfoRow 
            label={t('assetInfoPanel.fields.serialNumber', { defaultValue: 'Serial Number' })}
            value={asset.serial_number || t('common.states.na', { defaultValue: 'N/A' })}
            copyable={!!asset.serial_number}
            copyId="serial-number"
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
          <InfoRow 
            label={t('assetInfoPanel.fields.purchaseDate', { defaultValue: 'Purchase Date' })}
            value={asset.purchase_date
              ? formatDateOnly(new Date(asset.purchase_date))
              : t('common.states.na', { defaultValue: 'N/A' })}
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
          <InfoRow 
            label={t('assetInfoPanel.fields.warrantyEnd', { defaultValue: 'Warranty End' })}
            value={asset.warranty_end_date
              ? formatDateOnly(new Date(asset.warranty_end_date))
              : t('common.states.na', { defaultValue: 'N/A' })}
            copyLabel={t('assetInfoPanel.actions.copy', { defaultValue: 'Copy' })}
            copiedLabel={t('assetInfoPanel.actions.copied', { defaultValue: 'Copied' })}
          />
        </div>
      </CardContent>
    </Card>
  );
};
