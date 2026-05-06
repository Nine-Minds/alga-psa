import type { TFunction } from 'i18next';
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

type ClientPreviewBillingFrequency = BillingCycleType;
type ContractPreviewBillingFrequency = Extract<
  BillingCycleType,
  'monthly' | 'quarterly' | 'semi-annually' | 'annually'
>;

function resolveClientPreviewBillingFrequency(value: string | undefined): ClientPreviewBillingFrequency {
  switch (value) {
    case 'weekly':
      return 'weekly';
    case 'bi-weekly':
      return 'bi-weekly';
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
      return 'semi-annually';
    case 'annually':
      return 'annually';
    case 'monthly':
    default:
      return 'monthly';
  }
}

function resolveContractPreviewBillingFrequency(value: string | undefined): ContractPreviewBillingFrequency {
  switch (value) {
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
      return 'semi-annually';
    case 'annually':
      return 'annually';
    case 'weekly':
    case 'bi-weekly':
    case 'monthly':
    default:
      return 'monthly';
  }
}

function formatPreviewRange(start: string, end: string, t: TFunction) {
  return t('recurringPreview.rangeSeparator', {
    defaultValue: '{{start}} to {{end}}',
    start: start.slice(0, 10),
    end: end.slice(0, 10),
  });
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
  billingFrequency: string | undefined;
  t: TFunction;
}): RecurringAuthoringPreviewPeriod[] {
  const duePosition = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const sourceObligation = buildPreviewSourceObligation(input.cadenceOwner);

  const records = input.cadenceOwner === 'contract'
    ? materializeContractCadenceServicePeriods({
        asOf: CONTRACT_PREVIEW_AS_OF,
        materializedAt: CONTRACT_PREVIEW_AS_OF,
        billingCycle: resolveContractPreviewBillingFrequency(input.billingFrequency),
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
        billingCycle: resolveClientPreviewBillingFrequency(input.billingFrequency),
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
      input.t,
    ),
    invoiceWindowLabel: formatPreviewRange(
      record.invoiceWindow.start,
      record.invoiceWindow.end,
      input.t,
    ),
  }));
}

export function getRecurringAuthoringPreview(
  input: RecurringAuthoringPreviewInput,
  t: TFunction,
): RecurringAuthoringPreview {
  const cadenceOwner = input.cadenceOwner === 'contract' ? 'contract' : 'client';
  const billingTiming = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const enableProration = Boolean(input.enableProration);
  const billingFrequency = input.billingFrequency;

  return {
    cadenceOwnerLabel:
      cadenceOwner === 'contract'
        ? t('recurringPreview.cadenceOwner.contract.label', { defaultValue: 'Contract anniversary' })
        : t('recurringPreview.cadenceOwner.client.label', { defaultValue: 'Client billing schedule' }),
    cadenceOwnerSummary:
      cadenceOwner === 'contract'
        ? t('recurringPreview.cadenceOwner.contract.summary', {
            defaultValue: 'Service periods and invoice windows follow the contract anniversary dates.',
          })
        : t('recurringPreview.cadenceOwner.client.summary', {
            defaultValue: 'Service periods and invoice windows stay aligned to the client billing calendar.',
          }),
    billingTimingLabel:
      billingTiming === 'advance'
        ? t('recurringPreview.billingTiming.advance.label', { defaultValue: 'Advance' })
        : t('recurringPreview.billingTiming.arrears.label', { defaultValue: 'Arrears' }),
    billingTimingSummary:
      billingTiming === 'advance'
        ? t('recurringPreview.billingTiming.advance.summary', {
            defaultValue: 'Invoices post at the opening of the due service period.',
          })
        : t('recurringPreview.billingTiming.arrears.summary', {
            defaultValue: 'Invoices post after the covered service period closes.',
          }),
    firstInvoiceSummary:
      cadenceOwner === 'contract'
        ? billingTiming === 'advance'
          ? t('recurringPreview.firstInvoice.contract.advance', {
              defaultValue: 'First invoice: bill on the contract anniversary window that opens the first covered service period.',
            })
          : t('recurringPreview.firstInvoice.contract.arrears', {
              defaultValue: 'First invoice: bill on the next contract anniversary window after the first covered service period closes.',
            })
        : billingTiming === 'advance'
          ? t('recurringPreview.firstInvoice.client.advance', {
              defaultValue: 'First invoice: bill on the first client billing schedule window covering the service period.',
            })
          : t('recurringPreview.firstInvoice.client.arrears', {
              defaultValue: 'First invoice: bill on the next client billing schedule window after the first covered service period closes.',
            }),
    partialPeriodSummary: enableProration
      ? t('recurringPreview.partialPeriod.prorated', {
          defaultValue: 'Partial periods adjust the recurring fee to the covered portion of the service period.',
        })
      : t('recurringPreview.partialPeriod.full', {
          defaultValue: 'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
        }),
    materializedPeriodsHeading: t('recurringPreview.materializedPeriods.heading', {
      defaultValue: 'Illustrative future materialized periods',
    }),
    materializedPeriodsSummary:
      cadenceOwner === 'contract'
        ? t('recurringPreview.materializedPeriods.summary.contract', {
            defaultValue: 'If you save this recurring line, future periods would materialize on an anniversary-style preview anchored to the 8th before invoice generation.',
          })
        : t('recurringPreview.materializedPeriods.summary.client', {
            defaultValue: 'If you save this recurring line, future periods would materialize on the client billing schedule preview before invoice generation.',
          }),
    materializedPeriods: buildMaterializedPreviewPeriods({
      cadenceOwner,
      billingTiming,
      billingFrequency,
      t,
    }),
  };
}
