'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import AssetFormSkeleton from '@alga-psa/ui/components/skeletons/AssetFormSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface AssetFormClientProps {
  assetId: string;
  /** Forwarded to AssetForm; set by the edit drawer so saving doesn't navigate. */
  onSaved?: () => void;
  /** Forwarded to AssetForm; set by the edit drawer so Cancel closes it. */
  onCancel?: () => void;
  /** Forwarded to AssetForm; the drawer renders Save and Cancel in its footer. */
  hideActions?: boolean;
  onSavingChange?: (saving: boolean) => void;
}

export default function AssetFormClient({ assetId, onSaved, onCancel, hideActions, onSavingChange }: AssetFormClientProps) {
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

  return (
    <AssetForm
      assetId={assetId}
      onSaved={onSaved}
      onCancel={onCancel}
      hideActions={hideActions}
      onSavingChange={onSavingChange}
    />
  );
}
