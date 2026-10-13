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
      /** Last day the first invoice covers (the exclusive `servicePeriodEnd` minus one day), `YYYY-MM-DD`. For display. */
      servicePeriodEndInclusive: string;
      /** The unclipped schedule period containing the start date, `YYYY-MM-DD`. */
      schedulePeriodStart: string;
      schedulePeriodEnd: string;
      /** True when the start date falls strictly inside the schedule period (the first period is partial). */
      startsMidPeriod: boolean;
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

/** Calendar-day subtraction on a YMD string (UTC arithmetic on a date-only value, so no timezone drift). */
function minusOneDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function localYmd(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

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
  const servicePeriodStart = (activity?.start ?? record.servicePeriod.start).slice(0, 10);
  const servicePeriodEnd = (activity?.end ?? record.servicePeriod.end).slice(0, 10);
  const schedulePeriodStart = record.servicePeriod.start.slice(0, 10);
  return {
    status: 'date',
    scenario,
    invoiceDate: record.invoiceWindow.start.slice(0, 10),
    servicePeriodStart,
    servicePeriodEnd,
    servicePeriodEndInclusive: minusOneDay(servicePeriodEnd),
    schedulePeriodStart,
    schedulePeriodEnd: record.servicePeriod.end.slice(0, 10),
    startsMidPeriod: servicePeriodStart > schedulePeriodStart,
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

export type ArrearsFirstInvoiceHintInput = {
  lineType?: string;
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  /** Contract/line start date, `YYYY-MM-DD`. */
  startDate?: string | null;
  clientSchedule?: FirstInvoiceClientSchedule | null;
};

export type ArrearsFirstInvoiceHintResult = {
  /** First day the arrears invoice can be generated. */
  invoiceDate: string;
  /** First covered day (the contract start). */
  periodStart: string;
  /** Last covered day, inclusive. */
  periodEndInclusive: string;
  /** Invoice-window start of the period that In Advance would bill the same partial period on. */
  advanceInvoiceDate: string;
};

/**
 * Decides whether to tell the user that a Fixed, client-cadence, arrears line
 * starting partway through a client billing period will first invoice later
 * than they might expect. Returns `null` in every other case. This is the only
 * place that rule lives.
 *
 * When `today` is given (edit surfaces), the hint is suppressed once the first
 * invoice date is no longer in the future; the comparison is on local-date YMD
 * strings, never `Date` against UTC midnight.
 */
export function resolveArrearsFirstInvoiceHint(
  input: ArrearsFirstInvoiceHintInput,
  today?: Date,
): ArrearsFirstInvoiceHintResult | null {
  if (input.lineType !== 'Fixed') return null;
  if (input.cadenceOwner === 'contract') return null;
  if (input.billingTiming !== 'arrears') return null;
  if (!input.startDate || !input.clientSchedule) return null;

  const base = {
    startDate: input.startDate,
    clientSchedule: input.clientSchedule,
    cadenceOwner: 'client' as const,
  };
  const arrears = resolveFirstInvoiceDate({ ...base, billingTiming: 'arrears' });
  if (arrears.status !== 'date' || !arrears.startsMidPeriod) return null;
  if (today && !(arrears.invoiceDate > localYmd(today))) return null;

  const advance = resolveFirstInvoiceDate({ ...base, billingTiming: 'advance' });
  if (advance.status !== 'date') return null;

  return {
    invoiceDate: arrears.invoiceDate,
    periodStart: arrears.servicePeriodStart,
    periodEndInclusive: arrears.servicePeriodEndInclusive,
    advanceInvoiceDate: advance.invoiceDate,
  };
}
