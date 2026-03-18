import { describe, expect, it } from 'vitest';

import { applyRecurringServicePeriodEditRequest } from '@alga-psa/shared/billingClients/recurringServicePeriodEditRequests';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period edit request transport', () => {
  it('returns explicit success payloads with edited provenance for boundary adjustments', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_transport',
      periodKey: 'period:2026-05-10:2026-06-10',
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
    });

    const response = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'boundary_adjustment',
        recordId: 'rsp_transport',
        updatedServicePeriod: {
          start: '2026-05-12',
          end: '2026-06-10',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-05-12',
          end: '2026-06-10',
          semantics: 'half_open',
        },
      },
      context: {
        editedAt: '2026-03-18T18:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'transport-edit-1',
      },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error('Expected success response.');
    }
    expect(response.validationIssues).toEqual([]);
    expect(response.provenance).toMatchObject({
      kind: 'user_edited',
      reasonCode: 'boundary_adjustment',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'transport-edit-1',
      supersedesRecordId: 'rsp_transport',
    });
    expect(response.supersededRecord.lifecycleState).toBe('superseded');
    expect(response.editedRecord.lifecycleState).toBe('edited');
  });

  it('returns structured validation feedback instead of throwing for continuity errors', () => {
    const previousRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_prev',
      servicePeriod: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
    });
    const currentRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_current',
      periodKey: 'period:2026-05-10:2026-06-10',
      servicePeriod: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
    });
    const nextRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_next',
      servicePeriod: {
        start: '2026-06-10',
        end: '2026-07-10',
        semantics: 'half_open',
      },
    });

    const response = applyRecurringServicePeriodEditRequest({
      record: currentRecord,
      request: {
        operation: 'boundary_adjustment',
        recordId: 'rsp_current',
        updatedServicePeriod: {
          start: '2026-05-12',
          end: '2026-06-08',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-05-12',
          end: '2026-06-08',
          semantics: 'half_open',
        },
      },
      context: {
        editedAt: '2026-03-18T18:05:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      },
      siblingRecords: [previousRecord, currentRecord, nextRecord],
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected validation failure response.');
    }
    expect(response.validationIssues).toEqual([
      expect.objectContaining({
        code: 'continuity_gap_before',
        field: 'servicePeriod',
      }),
      expect.objectContaining({
        code: 'continuity_gap_after',
        field: 'servicePeriod',
      }),
    ]);
  });

  it('returns structured validation feedback for invalid defer input and record mismatches', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_defer',
      invoiceWindow: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
    });

    const missingWindow = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'defer',
        recordId: 'rsp_defer',
      },
      context: {
        editedAt: '2026-03-18T18:10:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      },
    });
    expect(missingWindow).toMatchObject({
      ok: false,
      operation: 'defer',
      recordId: 'rsp_defer',
      validationIssues: [
        expect.objectContaining({
          code: 'missing_deferred_invoice_window',
          field: 'deferredInvoiceWindow',
        }),
      ],
    });

    const mismatch = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'skip',
        recordId: 'rsp_other',
      },
      context: {
        editedAt: '2026-03-18T18:12:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      },
    });
    expect(mismatch).toMatchObject({
      ok: false,
      operation: 'skip',
      recordId: 'rsp_other',
      validationIssues: [
        expect.objectContaining({
          code: 'record_mismatch',
          field: 'recordId',
        }),
      ],
    });
  });
});
