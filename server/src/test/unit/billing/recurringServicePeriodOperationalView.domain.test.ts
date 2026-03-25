import { describe, expect, it } from 'vitest';

import { buildRecurringServicePeriodOperationalView } from '@alga-psa/shared/billingClients/recurringServicePeriodOperationalView';
import { buildRecurringServicePeriodListingQuery } from '@alga-psa/shared/billingClients/recurringServicePeriodListing';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period operational view', () => {
  it('T300: billing staff can inspect upcoming persisted service periods independently of invoice generation through the shared operational view contract', () => {
    const generatedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-generated',
      scheduleKey: 'schedule:client:line-1',
      sourceObligation: {
        obligationId: 'line-1',
        obligationType: 'contract_line',
        chargeFamily: 'fixed',
        tenant: 'tenant-1',
      },
      lifecycleState: 'generated',
      provenance: {
        kind: 'generated',
        sourceRuleVersion: 'line-1:v1',
        reasonCode: 'initial_materialization',
      },
      servicePeriod: {
        start: '2025-04-01',
        end: '2025-05-01',
        semantics: '[start,end)',
      },
      invoiceWindow: {
        start: '2025-04-01',
        end: '2025-05-01',
        semantics: '[start,end)',
      },
    });
    const skippedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-skipped',
      scheduleKey: 'schedule:client:line-2',
      sourceObligation: {
        obligationId: 'line-2',
        obligationType: 'contract_line',
        chargeFamily: 'license',
        tenant: 'tenant-1',
      },
      lifecycleState: 'skipped',
      duePosition: 'arrears',
      provenance: {
        kind: 'user_edited',
        sourceRuleVersion: 'line-2:v3',
        reasonCode: 'skip',
      },
      servicePeriod: {
        start: '2025-04-10',
        end: '2025-05-10',
        semantics: '[start,end)',
      },
      invoiceWindow: {
        start: '2025-05-10',
        end: '2025-06-10',
        semantics: '[start,end)',
      },
    });
    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-billed',
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: '[start,end)',
      },
      invoiceWindow: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: '[start,end)',
      },
    });

    const view = buildRecurringServicePeriodOperationalView({
      records: [skippedRecord, billedRecord, generatedRecord],
      query: buildRecurringServicePeriodListingQuery({
        tenant: 'tenant-1',
        asOf: '2025-03-15T00:00:00.000Z',
      }),
    });

    expect(view.query.asOf).toBe('2025-03-15T00:00:00.000Z');
    expect(view.rows).toHaveLength(2);
    expect(view.rows.map((row) => row.recordId)).toEqual([
      'rsp-generated',
      'rsp-skipped',
    ]);
    expect(view.rows[0]).toMatchObject({
      recordId: 'rsp-generated',
      chargeFamily: 'fixed',
      cadenceOwner: 'client',
      duePosition: 'advance',
      isException: false,
      displayState: {
        lifecycleState: 'generated',
        label: 'Generated',
      },
    });
    expect(view.rows[1]).toMatchObject({
      recordId: 'rsp-skipped',
      chargeFamily: 'license',
      duePosition: 'arrears',
      isException: true,
      displayState: {
        lifecycleState: 'skipped',
        label: 'Skipped',
        reasonLabel: 'Skipped by billing staff',
      },
    });
    expect(view.summary).toEqual({
      totalRows: 2,
      exceptionRows: 1,
      generatedRows: 1,
      editedRows: 0,
      skippedRows: 1,
      lockedRows: 0,
    });
  });
});
