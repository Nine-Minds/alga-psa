import { CONTRACT_LINE_SOURCE_BY_SELECTION_REASON, type ContractLineSource } from '@alga-psa/types';
import { resolveContractLineSelection } from './contractLineDisambiguation';

/**
 * Native default contract-line resolution for a time entry that arrived
 * without an explicit line.
 *
 * Extracted VERBATIM from `persistTimeEntry` so the time-source seam has one
 * place to call. Semantics are exactly main's:
 *  - eligibility and disambiguation stay in `contractLineDisambiguation`
 *    (no broadened eligibility, no explicit-line rejection);
 *  - ANY failure (including the billing-context lookup) is logged and degrades
 *    to `{ contractLineId: null, source: 'unresolved' }`; a resolution error
 *    never fails the save;
 *  - no locks are taken.
 *
 * `getBillingContext` is passed in (rather than imported) so this module does
 * not import the write core, and so the seam can supply a work-item context.
 */
export interface ResolveTimeEntryContractInput {
  serviceId: string;
  /** `work_date || start_time`, exactly as the write core derived it. */
  effectiveDate: string | Date;
  getBillingContext: () => Promise<{ clientId: string | null; billingProfileId: string | null }>;
}

export interface ResolvedTimeEntryContract {
  contractLineId: string | null;
  source: ContractLineSource | null;
}

export async function resolveTimeEntryContract(
  input: ResolveTimeEntryContractInput,
): Promise<ResolvedTimeEntryContract> {
  try {
    const { clientId: defaultContractClientId, billingProfileId: workItemBillingProfileId } =
      await input.getBillingContext();

    const selection = await resolveContractLineSelection(
      defaultContractClientId as string,
      input.serviceId,
      input.effectiveDate as any,
      { billingProfileId: workItemBillingProfileId }
    );

    // Always null (not undefined) so the UPDATE clears a stale id instead of
    // leaving it next to contract_line_source='unresolved'.
    return {
      contractLineId: selection.selectedContractLineId ?? null,
      // Record how the line was chosen, including the unresolved case: the
      // reason is what the review queue and the attribution inspector read
      // (F062, F063).
      source: CONTRACT_LINE_SOURCE_BY_SELECTION_REASON[selection.reason],
    };
  } catch (error) {
    console.error('Error determining default contract line:', error);
    return { contractLineId: null, source: 'unresolved' };
  }
}
