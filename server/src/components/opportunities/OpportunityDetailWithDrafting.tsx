'use client';

import { OpportunityDetailHost } from '@alga-psa/opportunities/components';
import type { IOpportunityDetail } from '@alga-psa/types';
import {
  generateFollowUpDraft,
  getOpportunityFollowUpRecipient,
  sendOpportunityFollowUp,
} from '@enterprise/lib/opportunities/draftingActions';
import { OpportunityCommitmentsSection } from './OpportunityCommitmentsSection';

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
}: {
  detail: IOpportunityDetail;
  draftingAvailable: boolean;
  managementAvailable?: boolean;
  autoOpenDraft?: boolean;
}) {
  return (
    <OpportunityDetailHost
      detail={detail}
      autoOpenDraft={autoOpenDraft}
      commitments={managementAvailable ? <OpportunityCommitmentsSection detail={detail} /> : undefined}
      drafting={
        draftingAvailable
          ? {
              generate: (opportunityId, tone) => generateFollowUpDraft(opportunityId, tone),
              getRecipient: (opportunityId) => getOpportunityFollowUpRecipient(opportunityId),
              send: (opportunityId, input) => sendOpportunityFollowUp(opportunityId, input),
            }
          : undefined
      }
    />
  );
}
