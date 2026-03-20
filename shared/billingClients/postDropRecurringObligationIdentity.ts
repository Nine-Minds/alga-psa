import type {
  IPersistedRecurringObligationRef,
  IRecurringObligationRef,
  RecurringChargeFamily,
} from '@alga-psa/types';

/**
 * Post-drop client cadence still persists `client_contract_line` as a logical
 * compatibility label, but the canonical surviving obligation id is always the
 * live `contract_line_id`.
 */
export const CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE = 'client_contract_line' as const;

export const POST_DROP_RECURRING_OBLIGATION_TYPES = [
  'contract_line',
  CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
] as const;

export function isClientCadencePostDropObligationType(
  value: unknown,
): value is typeof CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE {
  return value === CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE;
}

export function buildClientCadencePostDropObligationRef(input: {
  contractLineId: string;
  chargeFamily: RecurringChargeFamily;
  tenant?: string;
}): IRecurringObligationRef {
  return {
    obligationId: input.contractLineId,
    obligationType: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
    chargeFamily: input.chargeFamily,
    ...(input.tenant ? { tenant: input.tenant } : {}),
  };
}

export function buildPersistedClientCadencePostDropObligationRef(input: {
  tenant: string;
  contractLineId: string;
  chargeFamily: RecurringChargeFamily;
}): IPersistedRecurringObligationRef {
  return {
    tenant: input.tenant,
    obligationId: input.contractLineId,
    obligationType: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
    chargeFamily: input.chargeFamily,
  };
}

export function buildPostDropRecurringObligationCandidates(input: {
  contractLineId: string;
  chargeFamily: RecurringChargeFamily;
  tenant?: string;
}): readonly [IRecurringObligationRef, IRecurringObligationRef] {
  const contractLineCandidate: IRecurringObligationRef = {
    obligationId: input.contractLineId,
    obligationType: 'contract_line',
    chargeFamily: input.chargeFamily,
    ...(input.tenant ? { tenant: input.tenant } : {}),
  };

  return [
    contractLineCandidate,
    buildClientCadencePostDropObligationRef(input),
  ] as const;
}
