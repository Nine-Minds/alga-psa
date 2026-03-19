import type {
  BillingCycleType,
  DuePosition,
  IRecurringDueSelectionInput,
  IRecurringObligationRef,
  IRecurringRunExecutionWindowIdentity,
  ISO8601String,
  RecurringRunExecutionWindowKind,
} from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import {
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  resolveContractCadenceInvoiceWindowForServicePeriod,
} from './contractCadenceServicePeriods';

export interface RecurringRunSelectionIdentity {
  executionIdentityKeys: string[];
  selectionKey: string;
  retryKey: string;
}

export type ContractCadenceSchedulableFrequency = Extract<
  BillingCycleType,
  'monthly' | 'quarterly' | 'semi-annually' | 'annually'
>;

export interface ContractCadenceRecurringRunTarget {
  executionWindow: IRecurringRunExecutionWindowIdentity;
  selectorInput: IRecurringDueSelectionInput;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
}

function compactIdentitySegments(segments: Array<unknown>): string[] {
  return segments
    .map((segment) => {
      if (segment == null) {
        return undefined;
      }
      return String(segment).trim();
    })
    .filter((segment): segment is string => Boolean(segment && segment.length > 0));
}

export function buildRecurringRunExecutionIdentityKey(
  window: Omit<IRecurringRunExecutionWindowIdentity, 'identityKey'>,
): string {
  return compactIdentitySegments([
    window.kind,
    window.cadenceOwner,
    window.clientId,
    window.scheduleKey ?? undefined,
    window.periodKey ?? undefined,
    window.billingCycleId ?? undefined,
    window.contractId ?? undefined,
    window.contractLineId ?? undefined,
    window.windowStart ?? undefined,
    window.windowEnd ?? undefined,
  ]).join(':');
}

export function buildClientCadenceExecutionWindow(input: {
  clientId: string;
  scheduleKey: string;
  periodKey: string;
  windowStart: string;
  windowEnd: string;
}): IRecurringRunExecutionWindowIdentity {
  const baseWindow = {
    kind: 'client_cadence_window' as const,
    cadenceOwner: 'client' as const,
    clientId: input.clientId,
    scheduleKey: input.scheduleKey,
    periodKey: input.periodKey,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };

  return {
    ...baseWindow,
    identityKey: buildRecurringRunExecutionIdentityKey(baseWindow),
  };
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

export function buildRecurringRunSelectionIdentity(
  windows: Array<Pick<IRecurringRunExecutionWindowIdentity, 'identityKey'>>,
): RecurringRunSelectionIdentity {
  const executionIdentityKeys = Array.from(
    new Set(windows.map((window) => window.identityKey).filter(Boolean)),
  ).sort();
  const keyBody = executionIdentityKeys.join('|');

  return {
    executionIdentityKeys,
    selectionKey: `recurring-run-selection:${keyBody}`,
    retryKey: `recurring-run-retry:${keyBody}`,
  };
}

export function buildBillingCycleDueSelectionInput(input: {
  clientId: string;
  billingCycleId: string;
  windowStart: string;
  windowEnd: string;
}): IRecurringDueSelectionInput {
  return {
    clientId: input.clientId,
    billingCycleId: input.billingCycleId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    executionWindow: buildClientBillingCycleExecutionWindow({
      billingCycleId: input.billingCycleId,
      clientId: input.clientId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
  };
}

export function buildClientCadenceDueSelectionInput(input: {
  clientId: string;
  scheduleKey: string;
  periodKey: string;
  windowStart: string;
  windowEnd: string;
}): IRecurringDueSelectionInput {
  return {
    clientId: input.clientId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    executionWindow: buildClientCadenceExecutionWindow({
      clientId: input.clientId,
      scheduleKey: input.scheduleKey,
      periodKey: input.periodKey,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
  };
}

export function buildContractCadenceDueSelectionInput(input: {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  contractId?: string | null;
  contractLineId?: string | null;
}): IRecurringDueSelectionInput {
  return {
    clientId: input.clientId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    executionWindow: buildContractCadenceExecutionWindow({
      clientId: input.clientId,
      contractId: input.contractId ?? null,
      contractLineId: input.contractLineId ?? null,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
  };
}

const toPlainDate = (value: ISO8601String) => Temporal.PlainDate.from(value.slice(0, 10));

function rangesOverlap(
  left: { windowStart: ISO8601String; windowEnd: ISO8601String },
  right: { windowStart: ISO8601String; windowEnd: ISO8601String },
): boolean {
  return (
    Temporal.PlainDate.compare(toPlainDate(left.windowStart), toPlainDate(right.windowEnd)) < 0 &&
    Temporal.PlainDate.compare(toPlainDate(right.windowStart), toPlainDate(left.windowEnd)) < 0
  );
}

function getContractCadenceFrequencyDefinition(
  frequency: ContractCadenceSchedulableFrequency,
): {
  monthsPerPeriod: number;
  generate: (input: {
    rangeStart: ISO8601String;
    rangeEnd: ISO8601String;
    sourceObligation: IRecurringObligationRef;
    duePosition: DuePosition;
    anchorDate: ISO8601String;
  }) => ReturnType<typeof generateMonthlyContractCadenceServicePeriods>;
} {
  switch (frequency) {
    case 'monthly':
      return { monthsPerPeriod: 1, generate: generateMonthlyContractCadenceServicePeriods };
    case 'quarterly':
      return { monthsPerPeriod: 3, generate: generateQuarterlyContractCadenceServicePeriods };
    case 'semi-annually':
      return { monthsPerPeriod: 6, generate: generateSemiAnnualContractCadenceServicePeriods };
    case 'annually':
      return { monthsPerPeriod: 12, generate: generateAnnualContractCadenceServicePeriods };
  }
}

export function selectContractCadenceRecurringRunTargets(input: {
  clientId: string;
  frequency: ContractCadenceSchedulableFrequency;
  duePosition: DuePosition;
  anchorDate: ISO8601String;
  rangeStart: ISO8601String;
  rangeEnd: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  contractId?: string | null;
  contractLineId?: string | null;
}): ContractCadenceRecurringRunTarget[] {
  const definition = getContractCadenceFrequencyDefinition(input.frequency);
  const servicePeriodSearchStart = `${toPlainDate(input.rangeStart).subtract({ months: definition.monthsPerPeriod }).toString()}T00:00:00Z` as ISO8601String;
  const queryRange = {
    windowStart: input.rangeStart,
    windowEnd: input.rangeEnd,
  };

  return definition
    .generate({
      rangeStart: servicePeriodSearchStart,
      rangeEnd: input.rangeEnd,
      sourceObligation: input.sourceObligation,
      duePosition: input.duePosition,
      anchorDate: input.anchorDate,
    })
    .map((servicePeriod) => {
      const invoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
        servicePeriod,
        anchorDate: input.anchorDate,
        monthsPerPeriod: definition.monthsPerPeriod,
      });
      const selectorInput = buildContractCadenceDueSelectionInput({
        clientId: input.clientId,
        contractId: input.contractId ?? null,
        contractLineId: input.contractLineId ?? null,
        windowStart: invoiceWindow.start,
        windowEnd: invoiceWindow.end,
      });

      return {
        executionWindow: selectorInput.executionWindow,
        selectorInput,
        servicePeriodStart: servicePeriod.start,
        servicePeriodEnd: servicePeriod.end,
      };
    })
    .filter((target) =>
      rangesOverlap(
        {
          windowStart: target.selectorInput.windowStart,
          windowEnd: target.selectorInput.windowEnd,
        },
        queryRange,
      ),
    )
    .sort((left, right) => {
      if (left.selectorInput.windowStart !== right.selectorInput.windowStart) {
        return left.selectorInput.windowStart.localeCompare(right.selectorInput.windowStart);
      }
      return left.executionWindow.identityKey.localeCompare(right.executionWindow.identityKey);
    });
}
