'use client';

import { toast } from 'react-hot-toast';
import type { IClient } from '@alga-psa/types';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateClientRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateClientRouteClient({ closeMode }: CreateClientRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/clients');

  const handleClientAdded = (client: IClient) => {
    toast.success(
      t('quickCreate.success.client', {
        defaultValue: 'Client "{{name}}" created successfully',
        name: client.client_name,
      }),
    );
    router.refresh();
    window.dispatchEvent(new CustomEvent('alga:quick-create:created', { detail: { entity: 'client' } }));
    close();
  };

  return (
    <QuickAddClient
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onClientAdded={handleClientAdded}
    />
  );
}
