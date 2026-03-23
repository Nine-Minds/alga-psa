import type { BillingCycleType, IPersistedRecurringObligationRef } from '@alga-psa/types';

import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';

const CLIENT_PREVIEW_AS_OF = '2025-04-01T00:00:00Z';
const CONTRACT_PREVIEW_AS_OF = '2025-04-08T00:00:00Z';
const PREVIEW_PERIOD_COUNT = 3;

export type RecurringAuthoringPreviewInput = {
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  billingFrequency?: string;
  enableProration?: boolean;
};

export type RecurringAuthoringPreviewPeriod = {
  servicePeriodLabel: string;
  invoiceWindowLabel: string;
};

export type RecurringAuthoringPreview = {
  cadenceOwnerLabel: string;
  cadenceOwnerSummary: string;
  billingTimingLabel: string;
  billingTimingSummary: string;
  firstInvoiceSummary: string;
  partialPeriodSummary: string;
  materializedPeriodsHeading: string;
  materializedPeriodsSummary: string;
  materializedPeriods: RecurringAuthoringPreviewPeriod[];
};

function resolvePreviewBillingFrequency(value: string | undefined): Extract<
  BillingCycleType,
  'monthly' | 'quarterly' | 'annually'
> {
  switch (value) {
    case 'quarterly':
      return 'quarterly';
    case 'annually':
      return 'annually';
    default:
      return 'monthly';
  }
}

function formatPreviewRange(start: string, end: string) {
  return `${start.slice(0, 10)} to ${end.slice(0, 10)}`;
}

function buildPreviewSourceObligation(cadenceOwner: 'client' | 'contract'): IPersistedRecurringObligationRef {
  return {
    tenant: 'preview-tenant',
    obligationId: `preview-${cadenceOwner}-line`,
    obligationType: 'contract_line',
    chargeFamily: 'fixed',
  };
}

function buildMaterializedPreviewPeriods(input: {
  cadenceOwner: 'client' | 'contract';
  billingTiming: 'arrears' | 'advance';
  billingFrequency: Extract<BillingCycleType, 'monthly' | 'quarterly' | 'annually'>;
}): RecurringAuthoringPreviewPeriod[] {
  const duePosition = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const sourceObligation = buildPreviewSourceObligation(input.cadenceOwner);

  const records = input.cadenceOwner === 'contract'
    ? materializeContractCadenceServicePeriods({
        asOf: CONTRACT_PREVIEW_AS_OF,
        materializedAt: CONTRACT_PREVIEW_AS_OF,
        billingCycle: input.billingFrequency,
        anchorDate: CONTRACT_PREVIEW_AS_OF,
        sourceObligation,
        duePosition,
        sourceRuleVersion: 'preview:v1',
        sourceRunKey: 'authoring-preview',
        targetHorizonDays: 400,
        replenishmentThresholdDays: 30,
      }).records
    : materializeClientCadenceServicePeriods({
        asOf: CLIENT_PREVIEW_AS_OF,
        materializedAt: CLIENT_PREVIEW_AS_OF,
        billingCycle: input.billingFrequency,
        sourceObligation,
        duePosition,
        sourceRuleVersion: 'preview:v1',
        sourceRunKey: 'authoring-preview',
        targetHorizonDays: 400,
        replenishmentThresholdDays: 30,
      }).records;

  return records.slice(0, PREVIEW_PERIOD_COUNT).map((record) => ({
    servicePeriodLabel: formatPreviewRange(
      record.servicePeriod.start,
      record.servicePeriod.end,
    ),
    invoiceWindowLabel: formatPreviewRange(
      record.invoiceWindow.start,
      record.invoiceWindow.end,
    ),
  }));
}

export function getRecurringAuthoringPreview(
  input: RecurringAuthoringPreviewInput,
): RecurringAuthoringPreview {
  const cadenceOwner = input.cadenceOwner === 'contract' ? 'contract' : 'client';
  const billingTiming = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const enableProration = Boolean(input.enableProration);
  const billingFrequency = resolvePreviewBillingFrequency(input.billingFrequency);

  return {
    cadenceOwnerLabel:
      cadenceOwner === 'contract' ? 'Contract anniversary' : 'Client billing schedule',
    cadenceOwnerSummary:
      cadenceOwner === 'contract'
        ? 'Service periods and invoice windows follow the contract anniversary dates.'
        : 'Service periods and invoice windows stay aligned to the client billing calendar.',
    billingTimingLabel: billingTiming === 'advance' ? 'Advance' : 'Arrears',
    billingTimingSummary:
      billingTiming === 'advance'
        ? 'Invoices post at the opening of the due service period.'
        : 'Invoices post after the covered service period closes.',
    firstInvoiceSummary:
      cadenceOwner === 'contract'
        ? billingTiming === 'advance'
          ? 'First invoice: bill on the contract anniversary window that opens the first covered service period.'
          : 'First invoice: bill on the next contract anniversary window after the first covered service period closes.'
        : billingTiming === 'advance'
          ? 'First invoice: bill on the first client billing schedule window covering the service period.'
          : 'First invoice: bill on the next client billing schedule window after the first covered service period closes.',
    partialPeriodSummary: enableProration
      ? 'Partial periods adjust the recurring fee to the covered portion of the service period.'
      : 'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
    materializedPeriodsHeading: 'Illustrative future materialized periods',
    materializedPeriodsSummary:
      cadenceOwner === 'contract'
        ? 'If you save this recurring line, future periods would materialize on an anniversary-style preview anchored to the 8th before invoice generation.'
        : 'If you save this recurring line, future periods would materialize on the client billing schedule preview before invoice generation.',
    materializedPeriods: buildMaterializedPreviewPeriods({
      cadenceOwner,
      billingTiming,
      billingFrequency,
    }),
  };
}
