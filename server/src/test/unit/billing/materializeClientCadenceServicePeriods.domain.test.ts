import { describe, expect, it } from 'vitest';

import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { buildPersistedRecurringObligationRef } from '../../test-utils/recurringTimingFixtures';

describe('materialize client cadence service periods', () => {
  it('T343: client-cadence materialization generates persisted future service-period records with horizon coverage and canonical client-owned invoice windows', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'line-1',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });

    const advancePlan = materializeClientCadenceServicePeriods({
      asOf: '2026-01-10T00:00:00Z',
      materializedAt: '2026-01-10T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorSettings: { dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
      sourceRuleVersion: 'contract-line-1:v1',
      sourceRunKey: 'materialize-2026-01-10',
    });

    expect(advancePlan.scheduleKey).toBe(
      'schedule:tenant-1:contract_line:line-1:client:advance',
    );
    expect(advancePlan.coverage.meetsTargetHorizon).toBe(true);
    expect(advancePlan.coverage.needsReplenishment).toBe(false);
    expect(advancePlan.coverage.continuityIssues).toEqual([]);
    expect(advancePlan.records[0]).toMatchObject({
      cadenceOwner: 'client',
      duePosition: 'advance',
      lifecycleState: 'generated',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:advance',
      periodKey: 'period:2026-01-10:2026-02-10',
      servicePeriod: {
        start: '2026-01-10',
        end: '2026-02-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-01-10',
        end: '2026-02-10',
        semantics: 'half_open',
      },
      provenance: {
        kind: 'generated',
        reasonCode: 'initial_materialization',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'materialize-2026-01-10',
      },
      createdAt: '2026-01-10T12:00:00.000Z',
      updatedAt: '2026-01-10T12:00:00.000Z',
    });

    const arrearsPlan = materializeClientCadenceServicePeriods({
      asOf: '2026-01-10T00:00:00Z',
      materializedAt: '2026-01-10T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorSettings: { dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'arrears',
      sourceRuleVersion: 'contract-line-1:v1',
      sourceRunKey: 'materialize-2026-01-10',
    });

    expect(arrearsPlan.records[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:arrears',
      servicePeriod: {
        start: '2026-01-10',
        end: '2026-02-10',
      },
      invoiceWindow: {
        start: '2026-02-10',
        end: '2026-03-10',
      },
    });
    expect(arrearsPlan.records[0].recordId).toContain('client:arrears');
    expect(arrearsPlan.records.at(-1)?.servicePeriod.end >= '2026-07-09').toBe(true);
  });
});
