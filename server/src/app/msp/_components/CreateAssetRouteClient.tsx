'use client';

import { toast } from 'react-hot-toast';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateAssetRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateAssetRouteClient({ closeMode }: CreateAssetRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/assets');

  const handleAssetAdded = () => {
    toast.success(
      t('quickCreate.success.asset', { defaultValue: 'Asset created successfully' }),
    );
    router.refresh();
    close();
  };

  return (
    <QuickAddAsset
      onAssetAdded={handleAssetAdded}
      onClose={close}
      defaultOpen={true}
    />
  );
}
