import { describe, expect, it } from 'vitest';

import {
  assessRecurringServicePeriodGenerationCoverage,
  DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS,
  DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS,
  findRecurringServicePeriodContinuityIssues,
  resolveRecurringServicePeriodGenerationHorizon,
} from '@alga-psa/shared/billingClients/recurringServicePeriodGenerationHorizon';
import { buildRecurringServicePeriod } from '../../test-utils/recurringTimingFixtures';

describe('recurring service-period generation horizon', () => {
  it('T285: generation horizon defines target coverage, replenishment low-water behavior, and continuity checks that prevent future gaps or overlaps', () => {
    expect(DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS).toBe(180);
    expect(DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS).toBe(45);

    const horizon = resolveRecurringServicePeriodGenerationHorizon({
      asOf: '2025-01-01',
    });

    expect(horizon).toEqual({
      asOf: '2025-01-01',
      targetHorizonDays: 180,
      replenishmentThresholdDays: 45,
      targetHorizonEnd: '2025-06-30',
      replenishmentThresholdEnd: '2025-02-15',
    });

    const fullyCovered = assessRecurringServicePeriodGenerationCoverage({
      asOf: '2025-01-01',
      futurePeriods: [
        buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-01' }),
        buildRecurringServicePeriod({ start: '2025-02-01', end: '2025-03-01' }),
        buildRecurringServicePeriod({ start: '2025-03-01', end: '2025-04-01' }),
        buildRecurringServicePeriod({ start: '2025-04-01', end: '2025-05-01' }),
        buildRecurringServicePeriod({ start: '2025-05-01', end: '2025-06-01' }),
        buildRecurringServicePeriod({ start: '2025-06-01', end: '2025-07-01' }),
      ],
    });

    expect(fullyCovered.meetsTargetHorizon).toBe(true);
    expect(fullyCovered.needsReplenishment).toBe(false);
    expect(fullyCovered.continuityIssues).toEqual([]);

    const lowWaterCoverage = assessRecurringServicePeriodGenerationCoverage({
      asOf: '2025-01-01',
      futurePeriods: [
        buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-01' }),
      ],
    });

    expect(lowWaterCoverage.meetsTargetHorizon).toBe(false);
    expect(lowWaterCoverage.needsReplenishment).toBe(true);
    expect(lowWaterCoverage.furthestGeneratedEnd).toBe('2025-02-01');

    const belowTargetButNotYetLowWater = assessRecurringServicePeriodGenerationCoverage({
      asOf: '2025-01-01',
      futurePeriods: [
        buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-01' }),
        buildRecurringServicePeriod({ start: '2025-02-01', end: '2025-03-15' }),
      ],
    });

    expect(belowTargetButNotYetLowWater.meetsTargetHorizon).toBe(false);
    expect(belowTargetButNotYetLowWater.needsReplenishment).toBe(false);

    expect(findRecurringServicePeriodContinuityIssues([
      buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-01' }),
      buildRecurringServicePeriod({ start: '2025-02-02', end: '2025-03-01' }),
      buildRecurringServicePeriod({ start: '2025-03-01', end: '2025-04-01' }),
    ])).toEqual([
      {
        kind: 'gap',
        previousEnd: '2025-02-01',
        nextStart: '2025-02-02',
      },
    ]);

    expect(findRecurringServicePeriodContinuityIssues([
      buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-02' }),
      buildRecurringServicePeriod({ start: '2025-02-01', end: '2025-03-01' }),
    ])).toEqual([
      {
        kind: 'overlap',
        previousEnd: '2025-02-02',
        nextStart: '2025-02-01',
      },
    ]);
  });

  it('T014: recurring service-period replenishment reports missing-horizon state when future rows do not reach the configured target horizon', () => {
    const coverage = assessRecurringServicePeriodGenerationCoverage({
      asOf: '2025-01-01',
      targetHorizonDays: 90,
      replenishmentThresholdDays: 30,
      futurePeriods: [
        buildRecurringServicePeriod({ start: '2025-01-01', end: '2025-02-01' }),
      ],
    });

    expect(coverage.targetHorizonEnd).toBe('2025-04-01');
    expect(coverage.replenishmentThresholdEnd).toBe('2025-01-31');
    expect(coverage.furthestGeneratedEnd).toBe('2025-02-01');
    expect(coverage.meetsTargetHorizon).toBe(false);
    expect(coverage.needsReplenishment).toBe(false);
    expect(coverage.continuityIssues).toEqual([]);
  });
});
