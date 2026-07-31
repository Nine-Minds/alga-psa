import type { OpportunityStage } from '@alga-psa/types';

export interface SuggestedNextAction {
  key: string;
  fallback: string;
}

export const SUGGESTED_NEXT_ACTIONS: Record<OpportunityStage, readonly SuggestedNextAction[]> = {
  identified: [
    { key: 'opportunities.suggestedActions.scheduleDiscovery', fallback: 'Schedule discovery call' },
    { key: 'opportunities.suggestedActions.confirmDecisionMaker', fallback: 'Confirm the decision-maker' },
  ],
  qualified: [
    { key: 'opportunities.suggestedActions.bookAssessment', fallback: 'Book assessment' },
    { key: 'opportunities.suggestedActions.confirmRequirements', fallback: 'Confirm requirements and budget' },
  ],
  assessment: [
    { key: 'opportunities.suggestedActions.prepareQuote', fallback: 'Prepare quote' },
    { key: 'opportunities.suggestedActions.reviewFindings', fallback: 'Review assessment findings' },
  ],
  proposed: [
    { key: 'opportunities.suggestedActions.followUpQuote', fallback: 'Follow up on quote' },
    { key: 'opportunities.suggestedActions.scheduleProposalReview', fallback: 'Schedule proposal review' },
  ],
  verbal: [
    { key: 'opportunities.suggestedActions.confirmStartDate', fallback: 'Confirm start date' },
    { key: 'opportunities.suggestedActions.sendContract', fallback: 'Send contract' },
  ],
  won: [],
  lost: [],
};
