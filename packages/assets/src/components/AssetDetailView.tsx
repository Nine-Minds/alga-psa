'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AssetDetailHeader } from './AssetDetailHeader';
import { AssetBentoLayout } from './AssetBentoLayout';
import { useAssetDetail } from '@alga-psa/assets/hooks/useAssetDetail';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { PrintableDetailHeader, type PrintableDetailField } from '@alga-psa/ui/components/PrintableDetailHeader';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAssetStatusRegistry } from './shared/useAssetStatusOptions';
import { assetStatusLabel } from '../lib/assetStatus';

const DEEP_LINKABLE_FOCUS_VIEWS = ['software'];

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
    isRefreshing,
    rebootDevice,
    isRebooting,
  } = useAssetDetail(assetId);
  // Shared by the header's Edit action and the layout's tiles so there is only
  // ever one drawer open, with one rail.
  // Deep links (?tab=software) open the matching focus view; the Software tab
  // also reads ?software= as its initial filter.
  const searchParams = useSearchParams();
  const [focusView, setFocusView] = useState<string | null>(() => {
    const tab = searchParams?.get('tab');
    return tab && DEEP_LINKABLE_FOCUS_VIEWS.includes(tab) ? tab : null;
  });
  // F021: the print header reads the status label, not the stored slug.
  const { statuses: assetStatuses } = useAssetStatusRegistry();

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
    <div className="grow shrink-0">
      <AssetDetailHeader 
        asset={asset} 
        onRefresh={refreshRmmData}
        isRefreshing={isRefreshing}
        onReboot={rebootDevice}
        isRebooting={isRebooting}
        onEdit={() => setFocusView('edit')}
      />
      
      <div className="px-4 sm:px-6 lg:px-8 py-6" data-print-region data-print-title={asset.name}>
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
                value: assetStatusLabel(t, asset.status, assetStatuses),
              },
              {
                label: t('assetDetailView.fields.location', { defaultValue: 'Location' }),
                value: asset.location,
              },
            ] satisfies PrintableDetailField[]}
          />
        </div>
        {/* Bento layout: hero + 3/6/3 mosaic with the timeline as the centre
            spine, matching the ticket and client surfaces. Replaces the metrics
            banner, the 2/1 panel grid and the tab strip — the heavy panels are
            one hop away in the layout's focus drawer, and inventory provenance
            is rendered inside it. */}
        <AssetBentoLayout
          asset={asset}
          metrics={metrics}
          rmmData={rmmData}
          assetFacts={assetFacts}
          focusView={focusView}
          onFocusChange={setFocusView}
        />
      </div>
    </div>
  );
};
