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
});
