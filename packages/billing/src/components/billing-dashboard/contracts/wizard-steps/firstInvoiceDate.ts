import type {
  BillingCycleType,
  DuePosition,
  IPersistedRecurringObligationRef,
  IRecurringServicePeriodRecord,
} from '@alga-psa/types';
import type { NormalizedBillingCycleAnchorSettings } from '@alga-psa/shared/billingClients/billingCycleAnchors';
import { clipRecurringCandidatesToObligationBounds } from '@alga-psa/shared/billingClients/clipRecurringCandidatesToObligationBounds';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { getUnsupportedRecurringAuthoringCombination } from '@alga-psa/shared/billingClients/recurringAuthoringValidation';

/**
 * When does a new fixed-fee contract line first become invoiceable?
 *
 * This reuses the same generators the recurring-period materializer runs after
 * the contract is saved, so the date shown in the wizard is the first invoice
 * window the engine will actually open — it adds no date math of its own.
 */

export type FirstInvoiceScenario =
  | 'contract_arrears'
  | 'contract_advance'
  | 'client_arrears'
  | 'client_advance';

export type FirstInvoiceUnavailableReason =
  /** No (or an unparseable) contract start date has been entered yet. */
  | 'missing_start_date'
  /** The contract-anniversary cadence does not support this billing frequency. */
  | 'unsupported_frequency'
  /** Client cadence, but the client's billing schedule is not known (yet). */
  | 'client_schedule_unavailable';

/** The client's billing cycle and normalized anchor, as `getClientBillingCycleAnchor` returns them. */
export type FirstInvoiceClientSchedule = {
  billingCycle: BillingCycleType;
  anchor: NormalizedBillingCycleAnchorSettings;
};

export type FirstInvoiceDateInput = {
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  /** Line-level frequency for contract cadence; ignored for client cadence, which follows the client's cycle. */
  billingFrequency?: string;
  /** Contract start date, `YYYY-MM-DD`. */
  startDate?: string;
  /** Required for client cadence. `null`/`undefined` means it could not be loaded. */
  clientSchedule?: FirstInvoiceClientSchedule | null;
};

export type FirstInvoiceDate =
  | {
      status: 'date';
      scenario: FirstInvoiceScenario;
      /** First day the invoice can be generated (start of the first invoice window), `YYYY-MM-DD`. */
      invoiceDate: string;
      /** The first service period the invoice covers, clipped to the contract start. */
      servicePeriodStart: string;
      servicePeriodEnd: string;
    }
  | {
      status: 'unavailable';
      scenario: FirstInvoiceScenario;
      reason: FirstInvoiceUnavailableReason;
    };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const PREVIEW_OBLIGATION: IPersistedRecurringObligationRef = {
  tenant: 'first-invoice-preview',
  obligationId: 'first-invoice-preview-line',
  chargeFamily: 'fixed',
};

const toIsoMidnight = (ymd: string) => `${ymd}T00:00:00Z`;

function scenarioFor(
  cadenceOwner: 'client' | 'contract',
  duePosition: DuePosition,
): FirstInvoiceScenario {
  return `${cadenceOwner}_${duePosition}` as FirstInvoiceScenario;
}

function toResult(
  scenario: FirstInvoiceScenario,
  record: IRecurringServicePeriodRecord,
): FirstInvoiceDate {
  // Activity window is set when the contract starts inside the schedule period.
  const activity = record.activityWindow;
  return {
    status: 'date',
    scenario,
    invoiceDate: record.invoiceWindow.start.slice(0, 10),
    servicePeriodStart: (activity?.start ?? record.servicePeriod.start).slice(0, 10),
    servicePeriodEnd: (activity?.end ?? record.servicePeriod.end).slice(0, 10),
  };
}

export function resolveFirstInvoiceDate(input: FirstInvoiceDateInput): FirstInvoiceDate {
  const cadenceOwner = input.cadenceOwner === 'contract' ? 'contract' : 'client';
  const duePosition: DuePosition = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const scenario = scenarioFor(cadenceOwner, duePosition);
  const unavailable = (reason: FirstInvoiceUnavailableReason): FirstInvoiceDate => ({
    status: 'unavailable',
    scenario,
    reason,
  });

  const startDate = input.startDate?.slice(0, 10) ?? '';
  if (!YMD.test(startDate)) {
    return unavailable('missing_start_date');
  }
  const asOf = toIsoMidnight(startDate);

  if (cadenceOwner === 'contract') {
    const billingFrequency = input.billingFrequency || 'monthly';
    if (getUnsupportedRecurringAuthoringCombination({
      lineType: 'Fixed',
      cadenceOwner,
      billingFrequency,
    })) {
      return unavailable('unsupported_frequency');
    }

    // The contract anniversary is the start date, so the first period begins on it.
    const plan = materializeContractCadenceServicePeriods({
      asOf,
      materializedAt: asOf,
      billingCycle: billingFrequency as Parameters<typeof materializeContractCadenceServicePeriods>[0]['billingCycle'],
      anchorDate: asOf,
      sourceObligation: PREVIEW_OBLIGATION,
      duePosition,
      sourceRuleVersion: 'first-invoice-preview:v1',
      sourceRunKey: 'first-invoice-preview',
    });
    const first = plan.records[0];
    return first ? toResult(scenario, first) : unavailable('unsupported_frequency');
  }

  if (!input.clientSchedule) {
    return unavailable('client_schedule_unavailable');
  }

  // The first client-cadence period is the client's billing period that contains
  // the start date; the persisted window is then clipped to the contract start.
  const plan = materializeClientCadenceServicePeriods({
    asOf,
    materializedAt: asOf,
    billingCycle: input.clientSchedule.billingCycle,
    anchorSettings: input.clientSchedule.anchor,
    sourceObligation: PREVIEW_OBLIGATION,
    duePosition,
    sourceRuleVersion: 'first-invoice-preview:v1',
    sourceRunKey: 'first-invoice-preview',
  });
  const [first] = clipRecurringCandidatesToObligationBounds(plan.records, asOf, null);
  return first ? toResult(scenario, first) : unavailable('client_schedule_unavailable');
}
