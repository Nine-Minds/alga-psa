import type {
  BillingCycleType,
  DuePosition,
  IPersistedRecurringObligationRef,
  IRecurringDateRange,
  IRecurringServicePeriodRecord,
  ISO8601String,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import {
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  resolveContractCadenceInvoiceWindowForServicePeriod,
} from './contractCadenceServicePeriods';
import {
  assessRecurringServicePeriodGenerationCoverage,
  type IRecurringServicePeriodGenerationCoverageStatus,
  resolveRecurringServicePeriodGenerationHorizon,
} from './recurringServicePeriodGenerationHorizon';
import {
  buildRecurringServicePeriodPeriodKey,
  buildRecurringServicePeriodScheduleKey,
} from './recurringServicePeriodKeys';

type SupportedContractCadenceBillingCycle =
  Extract<BillingCycleType, 'monthly' | 'quarterly' | 'semi-annually' | 'annually'>;

export interface MaterializeContractCadenceServicePeriodsInput {
  asOf: ISO8601String;
  materializedAt: ISO8601String;
  billingCycle: SupportedContractCadenceBillingCycle;
  anchorDate: ISO8601String;
  sourceObligation: IPersistedRecurringObligationRef;
  duePosition: DuePosition;
  sourceRuleVersion: string;
  sourceRunKey: string;
  /**
   * Date the rolling 180-day coverage horizon is measured from. Generation still
   * starts at `asOf` so historical gaps are backfilled, but the target horizon
   * advances from this anchor instead. Omit it to keep the previous behaviour
   * (`asOf` anchors both the catch-up start and the horizon).
   */
  coverageAnchorDate?: ISO8601String;
  targetHorizonDays?: number;
  replenishmentThresholdDays?: number;
  /**
   * Upper bound on periods generated for one obligation in one call. Protects
   * the sweep from an ancient assignment with no billed floor. When the bound
   * is reached before the rolling horizon, the plan reports `hitPeriodCap` so
   * callers can log/expose the truncation instead of pretending coverage is
   * complete.
   */
  maxPeriodsPerRun?: number;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export const DEFAULT_CONTRACT_CADENCE_MAX_PERIODS_PER_RUN = 200;

export interface IContractCadenceMaterializedServicePeriodPlan {
  scheduleKey: string;
  coverage: IRecurringServicePeriodGenerationCoverageStatus;
  records: IRecurringServicePeriodRecord[];
  hitPeriodCap: boolean;
}

function toDateOnly(value: ISO8601String): ISO8601String {
  return `${value.slice(0, 10)}`;
}

function toRecordRange(period: Pick<IRecurringDateRange, 'start' | 'end'>): IRecurringDateRange {
  return {
    start: toDateOnly(period.start),
    end: toDateOnly(period.end),
    semantics: RECURRING_RANGE_SEMANTICS,
  };
}

function defaultRecordIdFactory(input: {
  scheduleKey: string;
  periodKey: string;
  revision: number;
}) {
  return `${input.scheduleKey}:${input.periodKey}:r${input.revision}`;
}

function resolveMonthsPerPeriod(billingCycle: SupportedContractCadenceBillingCycle) {
  switch (billingCycle) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semi-annually':
      return 6;
    case 'annually':
      return 12;
  }
}

function generateContractCadenceServicePeriods(
  input: MaterializeContractCadenceServicePeriodsInput,
  rangeEnd: ISO8601String,
  maxPeriods: number,
) {
  const commonInput = {
    rangeStart: input.asOf,
    rangeEnd,
    sourceObligation: input.sourceObligation,
    duePosition: input.duePosition,
    anchorDate: input.anchorDate,
    maxPeriods,
  };

  switch (input.billingCycle) {
    case 'monthly':
      return generateMonthlyContractCadenceServicePeriods(commonInput);
    case 'quarterly':
      return generateQuarterlyContractCadenceServicePeriods(commonInput);
    case 'semi-annually':
      return generateSemiAnnualContractCadenceServicePeriods(commonInput);
    case 'annually':
      return generateAnnualContractCadenceServicePeriods(commonInput);
  }
}

export function materializeContractCadenceServicePeriods(
  input: MaterializeContractCadenceServicePeriodsInput,
): IContractCadenceMaterializedServicePeriodPlan {
  // The horizon anchor may differ from the generation start: catch-up still
  // begins at `asOf`, but the rolling target is measured from the later
  // coverage anchor so a stale historical start cannot pin the future horizon
  // in the past.
  const coverageAnchor = toDateOnly(input.coverageAnchorDate ?? input.asOf);
  const horizon = resolveRecurringServicePeriodGenerationHorizon({
    asOf: coverageAnchor,
    targetHorizonDays: input.targetHorizonDays,
    replenishmentThresholdDays: input.replenishmentThresholdDays,
  });
  const maxPeriodsPerRun = input.maxPeriodsPerRun && input.maxPeriodsPerRun > 0
    ? input.maxPeriodsPerRun
    : DEFAULT_CONTRACT_CADENCE_MAX_PERIODS_PER_RUN;
  const servicePeriods = generateContractCadenceServicePeriods(
    input,
    `${horizon.targetHorizonEnd}T00:00:00Z`,
    maxPeriodsPerRun,
  );
  const hitPeriodCap = servicePeriods.length >= maxPeriodsPerRun
    && servicePeriods[servicePeriods.length - 1].end.slice(0, 10) < horizon.targetHorizonEnd;
  const scheduleKey = buildRecurringServicePeriodScheduleKey({
    tenant: input.sourceObligation.tenant,
    obligationType: input.sourceObligation.obligationType,
    obligationId: input.sourceObligation.obligationId,
    cadenceOwner: 'contract',
    duePosition: input.duePosition,
  });
  const monthsPerPeriod = resolveMonthsPerPeriod(input.billingCycle);
  const recordIdFactory = input.recordIdFactory ?? defaultRecordIdFactory;

  const records = servicePeriods.map((servicePeriod) => {
    const periodKey = buildRecurringServicePeriodPeriodKey(servicePeriod);
    const invoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
      servicePeriod,
      anchorDate: input.anchorDate,
      monthsPerPeriod,
    });

    return {
      kind: 'persisted_service_period_record',
      recordId: recordIdFactory({
        scheduleKey,
        periodKey,
        revision: 1,
      }),
      scheduleKey,
      periodKey,
      revision: 1,
      sourceObligation: input.sourceObligation,
      cadenceOwner: 'contract',
      duePosition: input.duePosition,
      lifecycleState: 'generated',
      servicePeriod: toRecordRange(servicePeriod),
      invoiceWindow: toRecordRange(invoiceWindow),
      timingMetadata: servicePeriod.timingMetadata,
      provenance: {
        kind: 'generated',
        reasonCode: 'initial_materialization',
        sourceRuleVersion: input.sourceRuleVersion,
        sourceRunKey: input.sourceRunKey,
      },
      createdAt: input.materializedAt,
      updatedAt: input.materializedAt,
    } satisfies IRecurringServicePeriodRecord;
  });

  return {
    scheduleKey,
    coverage: assessRecurringServicePeriodGenerationCoverage({
      asOf: coverageAnchor,
      targetHorizonDays: input.targetHorizonDays,
      replenishmentThresholdDays: input.replenishmentThresholdDays,
      futurePeriods: records.map((record) => record.servicePeriod),
    }),
    records,
    hitPeriodCap,
  };
}
