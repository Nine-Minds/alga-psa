import type {
  IRecurringDueSelectionInput,
  IRecurringDueWorkAttribution,
  IRecurringDueWorkRow,
  IRecurringRunExecutionWindowIdentity,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringDueWorkCadenceSource,
} from '@alga-psa/types';
import {
  buildClientCadenceDueSelectionInput,
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
  duePosition: IRecurringDueWorkRow['duePosition'];
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  clientName?: string | null;
  canGenerate?: boolean;
  asOf?: ISO8601String;
  billingCycleId?: string | null;
  scheduleKey?: string | null;
  periodKey?: string | null;
  recordId?: string | null;
  lifecycleState?: IRecurringDueWorkRow['lifecycleState'];
  contractName?: string | null;
  contractLineName?: string | null;
  purchaseOrderScopeKey?: string | null;
  currencyCode?: string | null;
  taxSource?: string | null;
  exportShapeKey?: string | null;
  attribution?: IRecurringDueWorkAttribution;
}

export interface ClientScheduleDueWorkWindowInput {
  clientId: string;
  clientName?: string | null;
  scheduleKey: string;
  periodKey: string;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  invoiceWindowStart?: ISO8601String;
  invoiceWindowEnd?: ISO8601String;
  asOf?: ISO8601String;
  canGenerate?: boolean;
  billingCycleId?: string | null;
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
  attribution?: IRecurringDueWorkAttribution;
  asOf?: ISO8601String;
  canGenerate?: boolean;
}

function formatRangeLabel(start: ISO8601String, end: ISO8601String) {
  return `${start} to ${end}`;
}

function normalizeDueWorkDate(value: unknown): ISO8601String {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10) as ISO8601String;
  }

  return String(value).slice(0, 10) as ISO8601String;
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

function isEarlyInvoiceWindow(windowStart: ISO8601String, asOf?: ISO8601String) {
  if (!asOf) {
    return false;
  }

  return String(windowStart).slice(0, 10) > String(asOf).slice(0, 10);
}

function buildBaseRecurringDueWorkRow(input: BuildRecurringDueWorkRowInput): IRecurringDueWorkRow {
  const executionWindow = input.selectorInput.executionWindow;
  const identity = buildRecurringDueWorkIdentity(executionWindow);
  const billingCycleId = input.billingCycleId ?? null;
  const invoiceWindowStart = normalizeDueWorkDate(input.selectorInput.windowStart);
  const invoiceWindowEnd = normalizeDueWorkDate(input.selectorInput.windowEnd);
  const contractId = executionWindow.contractId ?? null;
  const contractLineId = executionWindow.contractLineId ?? null;
  const isEarly = isEarlyInvoiceWindow(invoiceWindowStart, input.asOf);
  const servicePeriodStart = normalizeDueWorkDate(input.servicePeriodStart);
  const servicePeriodEnd = normalizeDueWorkDate(input.servicePeriodEnd);
  const canGenerate = (input.canGenerate ?? true) && !isEarly;

  return {
    ...identity,
    selectorInput: input.selectorInput,
    executionWindow,
    executionWindowKind: executionWindow.kind,
    cadenceOwner: executionWindow.cadenceOwner,
    cadenceSource: input.cadenceSource,
    duePosition: input.duePosition,
    dueState: isEarly ? 'early' : 'due',
    isEarly,
    canGenerate,
    clientId: input.selectorInput.clientId,
    clientName: input.clientName ?? null,
    billingCycleId,
    servicePeriodStart,
    servicePeriodEnd,
    servicePeriodLabel: formatRangeLabel(servicePeriodStart, servicePeriodEnd),
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
    purchaseOrderScopeKey: input.purchaseOrderScopeKey ?? null,
    currencyCode: input.currencyCode ?? null,
    taxSource: input.taxSource ?? null,
    exportShapeKey: input.exportShapeKey ?? null,
    attribution: input.attribution,
  };
}

export function buildRecurringDueWorkRow(
  input: BuildRecurringDueWorkRowInput,
): IRecurringDueWorkRow {
  return buildBaseRecurringDueWorkRow(input);
}

export function sortRecurringDueWorkRows(rows: IRecurringDueWorkRow[]): IRecurringDueWorkRow[] {
  return [...rows].sort((left, right) => {
    if (left.invoiceWindowEnd !== right.invoiceWindowEnd) {
      return right.invoiceWindowEnd.localeCompare(left.invoiceWindowEnd);
    }
    if (left.invoiceWindowStart !== right.invoiceWindowStart) {
      return right.invoiceWindowStart.localeCompare(left.invoiceWindowStart);
    }
    if (left.servicePeriodEnd !== right.servicePeriodEnd) {
      return right.servicePeriodEnd.localeCompare(left.servicePeriodEnd);
    }
    if (left.servicePeriodStart !== right.servicePeriodStart) {
      return right.servicePeriodStart.localeCompare(left.servicePeriodStart);
    }
    if ((left.clientName ?? '') !== (right.clientName ?? '')) {
      return (left.clientName ?? '').localeCompare(right.clientName ?? '');
    }

    return left.executionIdentityKey.localeCompare(right.executionIdentityKey);
  });
}

export function buildClientScheduleDueWorkRow(
  input: ClientScheduleDueWorkWindowInput,
): IRecurringDueWorkRow {
  const servicePeriodStart = normalizeDueWorkDate(input.servicePeriodStart);
  const servicePeriodEnd = normalizeDueWorkDate(input.servicePeriodEnd);
  const invoiceWindowStart = normalizeDueWorkDate(input.invoiceWindowStart ?? servicePeriodStart);
  const invoiceWindowEnd = normalizeDueWorkDate(input.invoiceWindowEnd ?? servicePeriodEnd);
  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: input.clientId,
    scheduleKey: input.scheduleKey,
    periodKey: input.periodKey,
    windowStart: invoiceWindowStart,
    windowEnd: invoiceWindowEnd,
  });

  return buildBaseRecurringDueWorkRow({
    selectorInput,
    cadenceSource: 'client_schedule',
    duePosition: input.scheduleKey.includes(':arrears') ? 'arrears' : 'advance',
    servicePeriodStart,
    servicePeriodEnd,
    clientName: input.clientName,
    canGenerate: input.canGenerate,
    asOf: input.asOf,
    billingCycleId: input.billingCycleId ?? null,
    scheduleKey: input.scheduleKey,
    periodKey: input.periodKey,
  });
}

export function buildServicePeriodRecurringDueWorkRow(
  input: ServicePeriodDueWorkRecordInput,
): IRecurringDueWorkRow {
  const { record } = input;
  const invoiceWindowStart = normalizeDueWorkDate(record.invoiceWindow.start);
  const invoiceWindowEnd = normalizeDueWorkDate(record.invoiceWindow.end);
  const selectorInput = record.cadenceOwner === 'contract'
    ? buildContractCadenceDueSelectionInput({
        clientId: input.clientId,
        contractId: input.contractId ?? null,
        contractLineId: input.contractLineId ?? null,
        windowStart: invoiceWindowStart,
        windowEnd: invoiceWindowEnd,
      })
    : buildClientCadenceDueSelectionInput({
          clientId: input.clientId,
          scheduleKey: record.scheduleKey,
          periodKey: record.periodKey,
          windowStart: invoiceWindowStart,
          windowEnd: invoiceWindowEnd,
        });

  return buildBaseRecurringDueWorkRow({
    selectorInput,
    cadenceSource: record.cadenceOwner === 'contract'
      ? 'contract_anniversary'
      : 'client_schedule',
    duePosition: record.duePosition,
    billingCycleId: input.billingCycleId ?? null,
    servicePeriodStart: normalizeDueWorkDate(record.servicePeriod.start),
    servicePeriodEnd: normalizeDueWorkDate(record.servicePeriod.end),
    clientName: input.clientName,
    canGenerate: input.canGenerate,
    asOf: input.asOf,
    scheduleKey: record.scheduleKey,
    periodKey: record.periodKey,
    recordId: record.recordId,
    lifecycleState: record.lifecycleState,
    contractName: input.contractName,
    contractLineName: input.contractLineName,
    attribution: input.attribution,
  });
}

export { buildRecurringDueWorkIdentity };
