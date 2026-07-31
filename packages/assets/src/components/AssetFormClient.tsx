'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import AssetFormSkeleton from '@alga-psa/ui/components/skeletons/AssetFormSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetFormClientProps {
  assetId: string;
  /** Forwarded to AssetForm; set by the edit drawer so saving doesn't navigate. */
  onSaved?: () => void;
}

export default function AssetFormClient({ assetId, onSaved }: AssetFormClientProps) {
  const { t } = useTranslation('msp/assets');
  const AssetForm = useMemo(() => dynamic(() => import('./AssetForm'), {
    loading: () => (
      <AssetFormSkeleton
        title={t('assetFormClient.loadingTitle', { defaultValue: 'Edit Asset' })}
        isEdit={true}
      />
    ),
    ssr: false,
  }), [t]);

  return <AssetForm assetId={assetId} onSaved={onSaved} />;
}
