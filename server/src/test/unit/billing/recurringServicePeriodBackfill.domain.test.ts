import { describe, expect, it } from 'vitest';

import { backfillRecurringServicePeriods } from '@alga-psa/shared/billingClients/backfillRecurringServicePeriods';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import {
  buildPersistedRecurringObligationRef,
  buildRecurringServicePeriodInvoiceLinkage,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('recurring service period backfill', () => {
  it('T286: existing client-cadence recurring lines backfill persisted future service periods without altering billed history', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'line-1',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });
    const materialized = materializeClientCadenceServicePeriods({
      asOf: '2026-03-18T00:00:00Z',
      materializedAt: '2026-03-18T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorSettings: { dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
      sourceRuleVersion: 'contract-line-1:v1',
      sourceRunKey: 'materialize-2026-03-18',
    });
    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_billed',
      scheduleKey: materialized.scheduleKey,
      periodKey: 'period:2026-03-10:2026-04-10',
      sourceObligation,
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2026-03-10',
        end: '2026-04-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-03-10',
        end: '2026-04-10',
        semantics: 'half_open',
      },
      invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage({
        invoiceChargeDetailId: 'detail-billed',
      }),
    });

    const backfillPlan = backfillRecurringServicePeriods({
      candidateRecords: materialized.records,
      existingRecords: [billedRecord],
      backfilledAt: '2026-03-18T12:30:00.000Z',
      sourceRuleVersion: 'contract-line-1:v1',
      sourceRunKey: 'backfill-2026-03-18',
      legacyBilledThroughEnd: '2026-04-10',
    });

    expect(backfillPlan.historicalBoundaryEnd).toBe('2026-04-10');
    expect(backfillPlan.retainedRecords).toEqual([billedRecord]);
    expect(backfillPlan.skippedHistoricalCandidates).toMatchObject([
      {
        periodKey: 'period:2026-03-10:2026-04-10',
        provenance: {
          kind: 'generated',
          reasonCode: 'backfill_materialization',
        },
      },
    ]);
    expect(backfillPlan.backfilledRecords[0]).toMatchObject({
      scheduleKey: materialized.scheduleKey,
      periodKey: 'period:2026-04-10:2026-05-10',
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-04-10',
        end: '2026-05-10',
      },
      provenance: {
        kind: 'generated',
        reasonCode: 'backfill_materialization',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'backfill-2026-03-18',
      },
      createdAt: '2026-03-18T12:30:00.000Z',
      updatedAt: '2026-03-18T12:30:00.000Z',
    });
    expect(backfillPlan.activeRecords.at(0)).toEqual(billedRecord);
    expect(backfillPlan.activeRecords.at(1)?.servicePeriod.start).toBe('2026-04-10');
  });

  it('T294: backfill realigns untouched future rows under explicit backfill provenance while keeping billed history untouched', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'line-2',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    });
    const materialized = materializeClientCadenceServicePeriods({
      asOf: '2026-03-18T00:00:00Z',
      materializedAt: '2026-03-18T12:00:00.000Z',
      billingCycle: 'monthly',
      anchorSettings: { dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
      sourceRuleVersion: 'contract-line-2:v2',
      sourceRunKey: 'materialize-2026-03-18',
    });
    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_billed_line_2',
      scheduleKey: materialized.scheduleKey,
      periodKey: 'period:2026-03-10:2026-04-10',
      sourceObligation,
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2026-03-10',
        end: '2026-04-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-03-10',
        end: '2026-04-10',
        semantics: 'half_open',
      },
      invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage({
        invoiceChargeDetailId: 'detail-billed-line-2',
      }),
    });
    const staleFutureRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_future_line_2',
      scheduleKey: materialized.scheduleKey,
      periodKey: 'period:2026-04-10:2026-05-10',
      sourceObligation,
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-04-11',
        end: '2026-05-11',
        semantics: 'half_open',
      },
      provenance: {
        kind: 'generated',
        reasonCode: 'initial_materialization',
        sourceRuleVersion: 'contract-line-2:v1',
        sourceRunKey: 'materialize-2026-03-12',
      },
    });

    const backfillPlan = backfillRecurringServicePeriods({
      candidateRecords: materialized.records,
      existingRecords: [billedRecord, staleFutureRecord],
      backfilledAt: '2026-03-18T12:30:00.000Z',
      sourceRuleVersion: 'contract-line-2:v2',
      sourceRunKey: 'backfill-2026-03-18',
      legacyBilledThroughEnd: '2026-04-10',
    });

    expect(backfillPlan.retainedRecords).toContainEqual(billedRecord);
    expect(backfillPlan.realignedRecords).toMatchObject([
      {
        scheduleKey: materialized.scheduleKey,
        periodKey: 'period:2026-04-10:2026-05-10',
        revision: 2,
        servicePeriod: {
          start: '2026-04-10',
          end: '2026-05-10',
        },
        invoiceWindow: {
          start: '2026-04-10',
          end: '2026-05-10',
        },
        provenance: {
          kind: 'regenerated',
          reasonCode: 'backfill_realignment',
          sourceRuleVersion: 'contract-line-2:v2',
          sourceRunKey: 'backfill-2026-03-18',
          supersedesRecordId: 'rsp_future_line_2',
        },
      },
    ]);
    expect(backfillPlan.supersededRecords).toMatchObject([
      {
        recordId: 'rsp_future_line_2',
        lifecycleState: 'superseded',
      },
    ]);
    expect(backfillPlan.backfilledRecords[0]).toMatchObject({
      periodKey: 'period:2026-05-10:2026-06-10',
      provenance: {
        reasonCode: 'backfill_materialization',
      },
    });
  });

  it('rejects candidate periods that overlap the billed-history boundary', () => {
    const sourceObligation = buildPersistedRecurringObligationRef({
      obligationId: 'line-overlap',
    });

    expect(() =>
      backfillRecurringServicePeriods({
        candidateRecords: [
          buildRecurringServicePeriodRecord({
            sourceObligation,
            scheduleKey: 'schedule:tenant-1:contract_line:line-overlap:client:advance',
            periodKey: 'period:2026-03-15:2026-04-15',
            servicePeriod: {
              start: '2026-03-15',
              end: '2026-04-15',
              semantics: 'half_open',
            },
            invoiceWindow: {
              start: '2026-03-15',
              end: '2026-04-15',
              semantics: 'half_open',
            },
          }),
        ],
        backfilledAt: '2026-03-18T12:30:00.000Z',
        sourceRuleVersion: 'contract-line-overlap:v1',
        sourceRunKey: 'backfill-2026-03-18',
        legacyBilledThroughEnd: '2026-04-10',
      }),
    ).toThrow('overlaps billed-history boundary 2026-04-10');
  });
});
