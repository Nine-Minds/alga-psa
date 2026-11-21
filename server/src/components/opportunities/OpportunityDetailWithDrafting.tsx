'use client';

import { useCallback } from 'react';
import { OpportunityDetailHost } from '@alga-psa/opportunities/components';
// Components/actions subpaths only (see OpportunityInteractionsSection).
import { InteractionDetails } from '@alga-psa/clients/components';
import { getInteractionById } from '@alga-psa/clients/actions';
import { useDrawer } from '@alga-psa/ui';
import type { IOpportunityDetail } from '@alga-psa/types';
import {
  generateFollowUpDraft,
  getOpportunityFollowUpRecipient,
  sendOpportunityFollowUp,
} from '@enterprise/lib/opportunities/draftingActions';
import { OpportunityCommitmentsSection } from './OpportunityCommitmentsSection';
import { OpportunityInteractionsSection } from './OpportunityInteractionsSection';

/**
 * Detail host with AI drafting callbacks injected. Rendered only when the
 * page's server-side check confirmed the tenant's AI module allows drafting;
 * the @enterprise alias resolves to CE stubs on community builds.
 */
export function OpportunityDetailWithDrafting({
  detail,
  draftingAvailable,
  managementAvailable = false,
  autoOpenDraft = false,
  returnTab,
}: {
  detail: IOpportunityDetail;
  draftingAvailable: boolean;
  managementAvailable?: boolean;
  autoOpenDraft?: boolean;
  returnTab?: string;
}) {
  const { openDrawer } = useDrawer();
  // Same drawer the Notes & interactions feed opens; a cited interaction that
  // has since been deleted simply doesn't open (the rung already says so).
  const openInteraction = useCallback(async (interactionId: string) => {
    try {
      const interaction = await getInteractionById(interactionId);
      if (!interaction || 'error' in (interaction as object)) return;
      openDrawer(<InteractionDetails interaction={interaction as any} />);
    } catch {
      // Deleted or unreadable: nothing to open.
    }
  }, [openDrawer]);

  return (
    <OpportunityDetailHost
      detail={detail}
      onOpenInteraction={openInteraction}
      autoOpenDraft={autoOpenDraft}
      returnTab={returnTab}
      commitments={managementAvailable ? <OpportunityCommitmentsSection detail={detail} /> : undefined}
      activity={
        <OpportunityInteractionsSection
          opportunityId={detail.opportunity_id}
          clientId={detail.client_id}
          contactId={detail.contact_id ?? undefined}
        />
      }
      drafting={
        draftingAvailable
          ? {
              generate: (opportunityId, request) => generateFollowUpDraft(opportunityId, request),
              getRecipient: (opportunityId) => getOpportunityFollowUpRecipient(opportunityId),
              send: (opportunityId, input) => sendOpportunityFollowUp(opportunityId, input),
            }
          : undefined
      }
    />
  );
}
