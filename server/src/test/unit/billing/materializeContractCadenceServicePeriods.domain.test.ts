import { describe, expect, it } from 'vitest';

import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { buildPersistedRecurringObligationRef } from '../../test-utils/recurringTimingFixtures';

describe('materialize contract cadence service periods', () => {
  it('T287: contract-cadence recurring lines materialize persisted future service periods with contract-owned invoice-window timing', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'contract-line-8',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });

    const advancePlan = materializeContractCadenceServicePeriods({
      asOf: '2026-01-08T00:00:00Z',
      materializedAt: '2026-01-08T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
      sourceRuleVersion: 'contract-line-8:v1',
      sourceRunKey: 'materialize-2026-01-08',
    });

    expect(advancePlan.scheduleKey).toBe(
      'schedule:tenant-1:contract_line:contract-line-8:contract:advance',
    );
    expect(advancePlan.coverage.meetsTargetHorizon).toBe(true);
    expect(advancePlan.records[0]).toMatchObject({
      cadenceOwner: 'contract',
      duePosition: 'advance',
      servicePeriod: {
        start: '2026-01-08',
        end: '2026-02-08',
      },
      invoiceWindow: {
        start: '2026-01-08',
        end: '2026-02-08',
      },
      timingMetadata: {
        anchorDate: '2026-01-08T00:00:00Z',
        boundarySource: 'assignment_start_date',
      },
      provenance: {
        kind: 'generated',
        reasonCode: 'initial_materialization',
      },
    });

    const arrearsPlan = materializeContractCadenceServicePeriods({
      asOf: '2026-01-08T00:00:00Z',
      materializedAt: '2026-01-08T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'arrears',
      sourceRuleVersion: 'contract-line-8:v1',
      sourceRunKey: 'materialize-2026-01-08',
    });

    expect(arrearsPlan.records[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:contract_line:contract-line-8:contract:arrears',
      servicePeriod: {
        start: '2026-01-08',
        end: '2026-02-08',
      },
      invoiceWindow: {
        start: '2026-02-08',
        end: '2026-03-08',
      },
    });
    expect(arrearsPlan.records.at(-1)?.servicePeriod.end >= '2026-07-07').toBe(true);
  });

  it('T288: coverageAnchorDate advances the rolling horizon without moving the catch-up start', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'contract-line-9',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });

    const plan = materializeContractCadenceServicePeriods({
      asOf: '2026-01-08T00:00:00Z',
      coverageAnchorDate: '2026-07-01T00:00:00Z',
      materializedAt: '2026-07-01T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'arrears',
      sourceRuleVersion: 'contract-line-9:v1',
      sourceRunKey: 'materialize-2026-07-01',
    });

    // Catch-up still begins at the historical start...
    expect(plan.records[0].servicePeriod.start).toBe('2026-01-08');
    // ...but the horizon is measured from the anchor, not the start.
    expect(plan.coverage.asOf).toBe('2026-07-01');
    expect(plan.coverage.targetHorizonEnd).toBe('2026-12-28');
    expect(plan.records.at(-1)?.servicePeriod.end >= '2026-12-28').toBe(true);
    expect(plan.hitPeriodCap).toBe(false);
  });

  it('T289: omitting coverageAnchorDate keeps asOf as the horizon anchor', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'contract-line-10',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });

    const plan = materializeContractCadenceServicePeriods({
      asOf: '2026-01-08T00:00:00Z',
      materializedAt: '2026-01-08T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
      sourceRuleVersion: 'contract-line-10:v1',
      sourceRunKey: 'materialize-2026-01-08',
    });

    expect(plan.coverage.asOf).toBe('2026-01-08');
    expect(plan.coverage.targetHorizonEnd).toBe('2026-07-07');
  });

  it('T290: reports hitPeriodCap instead of silently truncating long catch-up runs', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'contract-line-11',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });

    const cappedPlan = materializeContractCadenceServicePeriods({
      asOf: '2026-01-08T00:00:00Z',
      coverageAnchorDate: '2026-07-01T00:00:00Z',
      materializedAt: '2026-07-01T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'arrears',
      sourceRuleVersion: 'contract-line-11:v1',
      sourceRunKey: 'materialize-capped',
      maxPeriodsPerRun: 2,
    });

    expect(cappedPlan.records).toHaveLength(2);
    expect(cappedPlan.hitPeriodCap).toBe(true);
    expect(cappedPlan.coverage.meetsTargetHorizon).toBe(false);
  });
});
