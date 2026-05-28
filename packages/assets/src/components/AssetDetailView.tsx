'use client';

import React from 'react';
import { AssetDetailHeader } from './AssetDetailHeader';
import { AssetMetricsBanner } from './AssetMetricsBanner';
import { AssetDashboardGrid } from './AssetDashboardGrid';
import { AssetDetailTabs } from './AssetDetailTabs';
import { useAssetDetail } from '@alga-psa/assets/hooks/useAssetDetail';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { PrintableDetailHeader, type PrintableDetailField } from '@alga-psa/ui/components/PrintableDetailHeader';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetDetailViewProps {
  assetId: string;
}

export const AssetDetailView: React.FC<AssetDetailViewProps> = ({ assetId }) => {
  const { t } = useTranslation('msp/assets');
  const { 
    asset, 
    metrics, 
    rmmData, 
    assetFacts,
    isLoading, 
    refreshRmmData, 
    isRefreshing 
  } = useAssetDetail(assetId);

  if (isLoading && !asset) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingIndicator text={t('assetDetailView.loading', {
          defaultValue: 'Loading asset details...'
        })} />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-print-region>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('assetDetailView.errors.title', { defaultValue: 'Error' })}</AlertTitle>
          <AlertDescription>
            {t('assetDetailView.errors.notFound', {
              defaultValue: 'Asset not found or you do not have permission to view it.'
            })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grow shrink-0 bg-gray-50">
      <AssetDetailHeader 
        asset={asset} 
        onRefresh={refreshRmmData}
        isRefreshing={isRefreshing}
      />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-print-region data-print-title={asset.name}>
        <div className="app-print-section">
          <PrintableDetailHeader
            title={asset.name}
            subtitle={[asset.asset_type, asset.client?.client_name].filter(Boolean).join(' — ')}
            fields={[
              {
                label: t('assetDetailView.fields.assetTag', { defaultValue: 'Asset Tag' }),
                value: asset.asset_tag,
              },
              {
                label: t('assetDetailView.fields.serialNumber', { defaultValue: 'Serial Number' }),
                value: asset.serial_number,
              },
              {
                label: t('assetDetailView.fields.assetType', { defaultValue: 'Type' }),
                value: asset.asset_type,
              },
              {
                label: t('assetDetailView.fields.client', { defaultValue: 'Client' }),
                value: asset.client?.client_name,
              },
              {
                label: t('assetDetailView.fields.status', { defaultValue: 'Status' }),
                value: asset.status,
              },
              {
                label: t('assetDetailView.fields.location', { defaultValue: 'Location' }),
                value: asset.location,
              },
            ] satisfies PrintableDetailField[]}
          />
        </div>
        <AssetMetricsBanner
          metrics={metrics}
          isLoading={isLoading}
        />

        <AssetDashboardGrid
          asset={asset}
          rmmData={rmmData}
          assetFacts={assetFacts}
          metrics={metrics}
          isLoading={isLoading}
          onRefreshRmm={refreshRmmData}
          isRefreshingRmm={isRefreshing}
        />

        <AssetDetailTabs asset={asset} />
      </div>
    </div>
  );
};
