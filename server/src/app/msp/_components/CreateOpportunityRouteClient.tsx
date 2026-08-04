'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { IClient } from '@alga-psa/types';
import { CreateOpportunityDialog, type CreateOpportunityInput } from '@alga-psa/opportunities/components';
import { createOpportunity } from '@alga-psa/opportunities/actions';
import { getAllClients } from '@alga-psa/clients/actions/queryActions';
import { QuickAddClient } from '@alga-psa/clients/components';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateOpportunityRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateOpportunityRouteClient({ closeMode }: CreateOpportunityRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/opportunities');
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  useEffect(() => {
    getAllClients(false)
      .then(setClients)
      .catch((error) => {
        handleError(
          error,
          t('quickCreate.errors.loadClients', { defaultValue: 'Failed to load clients' }),
        );
      })
      .finally(() => setIsLoadingClients(false));
  }, [t]);

  const handleSubmit = async (input: CreateOpportunityInput) => {
    const created = await createOpportunity(input);
    toast.success(
      t('quickCreate.success.opportunity', {
        defaultValue: 'Opportunity "{{title}}" created successfully',
        title: input.title,
      }),
    );
    router.replace(`/msp/opportunities/${(created as { opportunity_id: string }).opportunity_id}`);
  };

  if (isLoadingClients) {
    return (
      <Dialog
        isOpen={true}
        onClose={close}
        title={t('quickCreate.dialogTitles.opportunity', { defaultValue: 'New Opportunity' })}
      >
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center p-8">
            <LoadingIndicator />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <CreateOpportunityDialog
      isOpen={true}
      onClose={close}
      clients={clients}
      onSubmit={handleSubmit}
      renderClientCreator={({ open, onOpenChange, onCreated }) => (
        <QuickAddClient
          open={open}
          onOpenChange={onOpenChange}
          initialLifecycleStatus="prospect"
          skipSuccessDialog
          onClientAdded={(client) => {
            setClients((current) => [client, ...current.filter((item) => item.client_id !== client.client_id)]);
            onCreated(client);
          }}
        />
      )}
    />
  );
}
