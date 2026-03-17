import type {
  IRecurringRunExecutionWindowIdentity,
  RecurringRunExecutionWindowKind,
} from '@alga-psa/types';

function compactIdentitySegments(segments: Array<string | null | undefined>): string[] {
  return segments
    .map((segment) => segment?.trim())
    .filter((segment): segment is string => Boolean(segment && segment.length > 0));
}

export function buildRecurringRunExecutionIdentityKey(
  window: Omit<IRecurringRunExecutionWindowIdentity, 'identityKey'>,
): string {
  return compactIdentitySegments([
    window.kind,
    window.cadenceOwner,
    window.clientId,
    window.billingCycleId ?? undefined,
    window.contractId ?? undefined,
    window.contractLineId ?? undefined,
    window.windowStart ?? undefined,
    window.windowEnd ?? undefined,
  ]).join(':');
}

export function buildClientBillingCycleExecutionWindow(input: {
  billingCycleId: string;
  clientId?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
}): IRecurringRunExecutionWindowIdentity {
  const baseWindow = {
    kind: 'billing_cycle_window' as const,
    cadenceOwner: 'client' as const,
    billingCycleId: input.billingCycleId,
    clientId: input.clientId,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
  };

  return {
    ...baseWindow,
    identityKey: buildRecurringRunExecutionIdentityKey(baseWindow),
  };
}

export function buildContractCadenceExecutionWindow(input: {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  contractId?: string | null;
  contractLineId?: string | null;
}): IRecurringRunExecutionWindowIdentity {
  const baseWindow = {
    kind: 'contract_cadence_window' as const,
    cadenceOwner: 'contract' as const,
    clientId: input.clientId,
    contractId: input.contractId ?? null,
    contractLineId: input.contractLineId ?? null,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };

  return {
    ...baseWindow,
    identityKey: buildRecurringRunExecutionIdentityKey(baseWindow),
  };
}

export function listRecurringRunExecutionWindowKinds(
  windows: Array<Pick<IRecurringRunExecutionWindowIdentity, 'kind'>>,
): RecurringRunExecutionWindowKind[] {
  return Array.from(new Set(windows.map((window) => window.kind))).sort() as RecurringRunExecutionWindowKind[];
}
