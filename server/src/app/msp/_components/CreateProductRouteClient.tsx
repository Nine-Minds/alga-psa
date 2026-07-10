'use client';

import { toast } from 'react-hot-toast';
import { QuickAddProduct } from '@alga-psa/billing/components/settings/billing/QuickAddProduct';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateProductRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateProductRouteClient({ closeMode }: CreateProductRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/billing');

  const handleProductAdded = () => {
    toast.success(
      t('quickCreate.success.product', { defaultValue: 'Product created successfully' }),
    );
    router.refresh();
    close();
  };

  return (
    <QuickAddProduct
      isOpen={true}
      onClose={close}
      onProductAdded={handleProductAdded}
    />
  );
}
