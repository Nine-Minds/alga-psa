import type {
  BillingCycleType,
  DuePosition,
  IPersistedRecurringObligationRef,
  IRecurringDateRange,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  ISO8601String,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import type { BillingCycleAnchorSettingsInput } from './billingCycleAnchors';
import {
  type ClientCadenceServicePeriodGenerationInput,
  type HistoricalBillingCycleBoundary,
  generateClientCadenceServicePeriods,
} from './clientCadenceServicePeriods';
import {
  assessRecurringServicePeriodGenerationCoverage,
  resolveRecurringServicePeriodGenerationHorizon,
  type IRecurringServicePeriodGenerationCoverageStatus,
} from './recurringServicePeriodGenerationHorizon';

export interface MaterializeClientCadenceServicePeriodsInput {
  asOf: ISO8601String;
  materializedAt: ISO8601String;
  billingCycle: BillingCycleType;
  sourceObligation: IPersistedRecurringObligationRef;
  duePosition: DuePosition;
  sourceRuleVersion: string;
  sourceRunKey: string;
  anchorSettings?: BillingCycleAnchorSettingsInput;
  historicalCycles?: HistoricalBillingCycleBoundary[];
  targetHorizonDays?: number;
  replenishmentThresholdDays?: number;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IClientCadenceMaterializedServicePeriodPlan {
  scheduleKey: string;
  coverage: IRecurringServicePeriodGenerationCoverageStatus;
  records: IRecurringServicePeriodRecord[];
}

function toDateOnly(value: ISO8601String): ISO8601String {
  return `${value.slice(0, 10)}`;
}

function addUtcDays(value: ISO8601String, days: number): ISO8601String {
  const next = new Date(`${toDateOnly(value)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10) as ISO8601String;
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
  return `schedule:${sourceObligation.tenant}:${sourceObligation.obligationType}:${sourceObligation.obligationId}:client:${duePosition}`;
}

function buildPeriodKey(servicePeriod: IRecurringServicePeriod) {
  return `period:${toDateOnly(servicePeriod.start)}:${toDateOnly(servicePeriod.end)}`;
}

function defaultRecordIdFactory(input: {
  scheduleKey: string;
  periodKey: string;
  revision: number;
}) {
  return `${input.scheduleKey}:${input.periodKey}:r${input.revision}`;
}

function resolveNextInvoiceWindow(
  servicePeriod: IRecurringServicePeriod,
  generationInput: ClientCadenceServicePeriodGenerationInput,
  cache: Map<string, IRecurringDateRange>,
): IRecurringDateRange {
  const cacheKey = `${servicePeriod.end}:${generationInput.billingCycle}:${generationInput.duePosition}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const nextPeriods = generateClientCadenceServicePeriods({
    ...generationInput,
    rangeStart: servicePeriod.end,
    rangeEnd: `${addUtcDays(servicePeriod.end, 1)}T00:00:00Z`,
  });
  const nextPeriod = nextPeriods[0];

  if (!nextPeriod) {
    throw new Error('Client cadence materialization could not derive the next invoice window for arrears timing.');
  }

  const nextWindow = toRecordRange(nextPeriod);
  cache.set(cacheKey, nextWindow);
  return nextWindow;
}

export function materializeClientCadenceServicePeriods(
  input: MaterializeClientCadenceServicePeriodsInput,
): IClientCadenceMaterializedServicePeriodPlan {
  const horizon = resolveRecurringServicePeriodGenerationHorizon({
    asOf: toDateOnly(input.asOf),
    targetHorizonDays: input.targetHorizonDays,
    replenishmentThresholdDays: input.replenishmentThresholdDays,
  });
  const generationInput: ClientCadenceServicePeriodGenerationInput = {
    billingCycle: input.billingCycle,
    rangeStart: input.asOf,
    rangeEnd: `${horizon.targetHorizonEnd}T00:00:00Z`,
    sourceObligation: input.sourceObligation,
    duePosition: input.duePosition,
    anchorSettings: input.anchorSettings,
    historicalCycles: input.historicalCycles,
  };
  const servicePeriods = generateClientCadenceServicePeriods(generationInput);
  const scheduleKey = buildScheduleKey(input.sourceObligation, input.duePosition);
  const nextInvoiceWindowCache = new Map<string, IRecurringDateRange>();
  const recordIdFactory = input.recordIdFactory ?? defaultRecordIdFactory;

  const records = servicePeriods.map((servicePeriod) => {
    const periodKey = buildPeriodKey(servicePeriod);
    const invoiceWindow = input.duePosition === 'advance'
      ? toRecordRange(servicePeriod)
      : resolveNextInvoiceWindow(servicePeriod, generationInput, nextInvoiceWindowCache);

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
      cadenceOwner: 'client',
      duePosition: input.duePosition,
      lifecycleState: 'generated',
      servicePeriod: toRecordRange(servicePeriod),
      invoiceWindow,
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
