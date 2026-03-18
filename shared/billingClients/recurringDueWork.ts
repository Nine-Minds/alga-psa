import type {
  IRecurringDueSelectionInput,
  IRecurringDueWorkRow,
  IRecurringRunExecutionWindowIdentity,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringDueWorkCadenceSource,
} from '@alga-psa/types';
import {
  buildBillingCycleDueSelectionInput,
  buildContractCadenceDueSelectionInput,
  buildRecurringRunSelectionIdentity,
} from './recurringRunExecutionIdentity';

export interface RecurringDueWorkIdentity {
  rowKey: string;
  executionIdentityKey: string;
  selectionKey: string;
  retryKey: string;
}

interface BuildRecurringDueWorkRowInput {
  selectorInput: IRecurringDueSelectionInput;
  cadenceSource: RecurringDueWorkCadenceSource;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  clientName?: string | null;
  canGenerate?: boolean;
  asOf?: ISO8601String;
  scheduleKey?: string | null;
  periodKey?: string | null;
  recordId?: string | null;
  lifecycleState?: IRecurringDueWorkRow['lifecycleState'];
  contractName?: string | null;
  contractLineName?: string | null;
}

export interface ClientScheduleDueWorkWindowInput {
  clientId: string;
  clientName?: string | null;
  billingCycleId: string;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  invoiceWindowStart?: ISO8601String;
  invoiceWindowEnd?: ISO8601String;
  asOf?: ISO8601String;
  canGenerate?: boolean;
}

export interface ServicePeriodDueWorkRecordInput {
  clientId: string;
  clientName?: string | null;
  record: IRecurringServicePeriodRecord;
  billingCycleId?: string | null;
  contractId?: string | null;
  contractLineId?: string | null;
  contractName?: string | null;
  contractLineName?: string | null;
  asOf?: ISO8601String;
  canGenerate?: boolean;
}

function formatRangeLabel(start: ISO8601String, end: ISO8601String) {
  return `${start} to ${end}`;
}

function buildRecurringDueWorkIdentity(
  executionWindow: IRecurringRunExecutionWindowIdentity,
): RecurringDueWorkIdentity {
  const selectionIdentity = buildRecurringRunSelectionIdentity([executionWindow]);

  return {
    rowKey: `recurring-due-row:${executionWindow.identityKey}`,
    executionIdentityKey: executionWindow.identityKey,
    selectionKey: selectionIdentity.selectionKey,
    retryKey: selectionIdentity.retryKey,
  };
}

function isEarlyInvoiceWindow(windowEnd: ISO8601String, asOf?: ISO8601String) {
  if (!asOf) {
    return false;
  }

  return windowEnd.slice(0, 10) > asOf.slice(0, 10);
}

function buildBaseRecurringDueWorkRow(input: BuildRecurringDueWorkRowInput): IRecurringDueWorkRow {
  const executionWindow = input.selectorInput.executionWindow;
  const identity = buildRecurringDueWorkIdentity(executionWindow);
  const billingCycleId = input.selectorInput.billingCycleId ?? executionWindow.billingCycleId ?? null;
  const invoiceWindowStart = input.selectorInput.windowStart;
  const invoiceWindowEnd = input.selectorInput.windowEnd;
  const contractId = executionWindow.contractId ?? null;
  const contractLineId = executionWindow.contractLineId ?? null;
  const isEarly = isEarlyInvoiceWindow(invoiceWindowEnd, input.asOf);

  return {
    ...identity,
    selectorInput: input.selectorInput,
    executionWindow,
    executionWindowKind: executionWindow.kind,
    cadenceOwner: executionWindow.cadenceOwner,
    cadenceSource: input.cadenceSource,
    dueState: isEarly ? 'early' : 'due',
    isEarly,
    canGenerate: input.canGenerate ?? true,
    clientId: input.selectorInput.clientId,
    clientName: input.clientName ?? null,
    billingCycleId,
    hasBillingCycleBridge: Boolean(billingCycleId),
    servicePeriodStart: input.servicePeriodStart,
    servicePeriodEnd: input.servicePeriodEnd,
    servicePeriodLabel: formatRangeLabel(input.servicePeriodStart, input.servicePeriodEnd),
    invoiceWindowStart,
    invoiceWindowEnd,
    invoiceWindowLabel: formatRangeLabel(invoiceWindowStart, invoiceWindowEnd),
    scheduleKey: input.scheduleKey ?? null,
    periodKey: input.periodKey ?? null,
    recordId: input.recordId ?? null,
    lifecycleState: input.lifecycleState ?? null,
    contractId,
    contractLineId,
    contractName: input.contractName ?? null,
    contractLineName: input.contractLineName ?? null,
  };
}

export function buildRecurringDueWorkRow(
  input: BuildRecurringDueWorkRowInput,
): IRecurringDueWorkRow {
  return buildBaseRecurringDueWorkRow(input);
}

export function buildClientScheduleDueWorkRow(
  input: ClientScheduleDueWorkWindowInput,
): IRecurringDueWorkRow {
  const invoiceWindowStart = input.invoiceWindowStart ?? input.servicePeriodStart;
  const invoiceWindowEnd = input.invoiceWindowEnd ?? input.servicePeriodEnd;
  const selectorInput = buildBillingCycleDueSelectionInput({
    clientId: input.clientId,
    billingCycleId: input.billingCycleId,
    windowStart: invoiceWindowStart,
    windowEnd: invoiceWindowEnd,
  });

  return buildBaseRecurringDueWorkRow({
    selectorInput,
    cadenceSource: 'client_schedule',
    servicePeriodStart: input.servicePeriodStart,
    servicePeriodEnd: input.servicePeriodEnd,
    clientName: input.clientName,
    canGenerate: input.canGenerate,
    asOf: input.asOf,
  });
}

export function buildServicePeriodRecurringDueWorkRow(
  input: ServicePeriodDueWorkRecordInput,
): IRecurringDueWorkRow {
  const { record } = input;
  const invoiceWindowStart = record.invoiceWindow.start;
  const invoiceWindowEnd = record.invoiceWindow.end;
  const selectorInput = record.cadenceOwner === 'contract'
    ? buildContractCadenceDueSelectionInput({
        clientId: input.clientId,
        contractId: input.contractId ?? null,
        contractLineId: input.contractLineId ?? null,
        windowStart: invoiceWindowStart,
        windowEnd: invoiceWindowEnd,
      })
    : (() => {
        if (!input.billingCycleId) {
          throw new Error(
            `Client cadence due-work rows require a billingCycleId bridge for record ${record.recordId}.`,
          );
        }

        return buildBillingCycleDueSelectionInput({
          clientId: input.clientId,
          billingCycleId: input.billingCycleId,
          windowStart: invoiceWindowStart,
          windowEnd: invoiceWindowEnd,
        });
      })();

  return buildBaseRecurringDueWorkRow({
    selectorInput,
    cadenceSource: record.cadenceOwner === 'contract'
      ? 'contract_anniversary'
      : 'client_schedule',
    servicePeriodStart: record.servicePeriod.start,
    servicePeriodEnd: record.servicePeriod.end,
    clientName: input.clientName,
    canGenerate: input.canGenerate,
    asOf: input.asOf,
    scheduleKey: record.scheduleKey,
    periodKey: record.periodKey,
    recordId: record.recordId,
    lifecycleState: record.lifecycleState,
    contractName: input.contractName,
    contractLineName: input.contractLineName,
  });
}

export { buildRecurringDueWorkIdentity };
