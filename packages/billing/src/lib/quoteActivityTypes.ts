/**
 * Canonical `quote_activities.activity_type` values written by the quote
 * approval / acceptance workflow. The UI server actions (quoteActions.ts) and the
 * REST API (QuoteService) must both use these so the audit trail has one vocabulary.
 *
 * `approvalChangesRequested` is canonical for "approver sent the quote back to draft".
 * The API previously wrote `changes_requested` (alga-2026-0002597); that value is
 * kept only in LEGACY_QUOTE_ACTIVITY_TYPE_ALIASES so old rows can still be read.
 */
export const QUOTE_ACTIVITY_TYPES = {
  approved: 'approved',
  approvalChangesRequested: 'approval_changes_requested',
  accepted: 'accepted',
} as const;

export type QuoteActivityType = (typeof QUOTE_ACTIVITY_TYPES)[keyof typeof QUOTE_ACTIVITY_TYPES];

/** Historic activity_type values written before the vocabulary was unified. */
export const LEGACY_QUOTE_ACTIVITY_TYPE_ALIASES: Readonly<Record<string, QuoteActivityType>> = {
  changes_requested: QUOTE_ACTIVITY_TYPES.approvalChangesRequested,
};

/**
 * Activity payload for "approver sent the quote back for changes". Shared by the UI
 * server action and the REST service so both write identical rows.
 */
export function buildApprovalChangesRequestedActivity(comment: string) {
  return {
    activity_type: QUOTE_ACTIVITY_TYPES.approvalChangesRequested,
    description: `Approval changes requested: ${comment}`,
    metadata: { comment },
  };
}
