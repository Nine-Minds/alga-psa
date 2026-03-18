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
  targetHorizonDays?: number;
  replenishmentThresholdDays?: number;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IContractCadenceMaterializedServicePeriodPlan {
  scheduleKey: string;
  coverage: IRecurringServicePeriodGenerationCoverageStatus;
  records: IRecurringServicePeriodRecord[];
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

function buildScheduleKey(
  sourceObligation: IPersistedRecurringObligationRef,
  duePosition: DuePosition,
) {
  return `schedule:${sourceObligation.tenant}:${sourceObligation.obligationType}:${sourceObligation.obligationId}:contract:${duePosition}`;
}

function buildPeriodKey(period: Pick<IRecurringDateRange, 'start' | 'end'>) {
  return `period:${toDateOnly(period.start)}:${toDateOnly(period.end)}`;
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
) {
  const commonInput = {
    rangeStart: input.asOf,
    rangeEnd,
    sourceObligation: input.sourceObligation,
    duePosition: input.duePosition,
    anchorDate: input.anchorDate,
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
  const horizon = resolveRecurringServicePeriodGenerationHorizon({
    asOf: toDateOnly(input.asOf),
    targetHorizonDays: input.targetHorizonDays,
    replenishmentThresholdDays: input.replenishmentThresholdDays,
  });
  const servicePeriods = generateContractCadenceServicePeriods(
    input,
    `${horizon.targetHorizonEnd}T00:00:00Z`,
  );
  const scheduleKey = buildScheduleKey(input.sourceObligation, input.duePosition);
  const monthsPerPeriod = resolveMonthsPerPeriod(input.billingCycle);
  const recordIdFactory = input.recordIdFactory ?? defaultRecordIdFactory;

  const records = servicePeriods.map((servicePeriod) => {
    const periodKey = buildPeriodKey(servicePeriod);
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
      asOf: toDateOnly(input.asOf),
      targetHorizonDays: input.targetHorizonDays,
      replenishmentThresholdDays: input.replenishmentThresholdDays,
      futurePeriods: records.map((record) => record.servicePeriod),
    }),
    records,
  };
}
