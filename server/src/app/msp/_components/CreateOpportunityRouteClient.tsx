'use client';

import { toast } from 'react-hot-toast';
import { CreateOpportunityDialog, type CreateOpportunityInput } from '@alga-psa/opportunities/components';
import { createOpportunity } from '@alga-psa/opportunities/actions';
import { QuickAddClient } from '@alga-psa/clients/components';
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
  const handleSubmit = async (input: CreateOpportunityInput) => {
    try {
      const created = await createOpportunity(input);
      toast.success(
        t('quickCreate.success.opportunity', {
          defaultValue: 'Opportunity "{{title}}" created successfully',
          title: input.title,
        }),
      );
      router.replace(`/msp/opportunities/${(created as { opportunity_id: string }).opportunity_id}`);
    } catch (err) {
      // Surface the failure and rethrow so the dialog stays open for a retry,
      // matching OpportunitiesHub.handleCreate.
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  return (
    <CreateOpportunityDialog
      isOpen={true}
      onClose={close}
      onSubmit={handleSubmit}
      renderClientCreator={({ open, onOpenChange, onCreated }) => (
        <QuickAddClient
          open={open}
          onOpenChange={onOpenChange}
          initialLifecycleStatus="prospect"
          skipSuccessDialog
          onClientAdded={(client) => {
            onCreated(client);
          }}
        />
      )}
    />
  );
}
