import { describe, expect, it } from 'vitest';

import { applyRecurringServicePeriodEditRequest } from '@alga-psa/shared/billingClients/recurringServicePeriodEditRequests';
import {
  buildRecurringServicePeriodInvoiceLinkage,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('recurring service period edit requests', () => {
  it('T295: boundary-adjustment edits to future persisted service periods are validated and saved explicitly', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_edit_request',
      servicePeriod: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
    });

    const success = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'boundary_adjustment',
        recordId: 'rsp_edit_request',
        updatedInvoiceWindow: {
          start: '2026-04-05',
          end: '2026-05-05',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-04-05',
          end: '2026-05-01',
          semantics: 'half_open',
        },
      },
      context: {
        editedAt: '2026-03-18T20:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'edit-request-success',
      },
    });

    expect(success).toMatchObject({
      ok: true,
      operation: 'boundary_adjustment',
      recordId: 'rsp_edit_request',
      editedRecord: {
        lifecycleState: 'edited',
        invoiceWindow: {
          start: '2026-04-05',
          end: '2026-05-05',
        },
        activityWindow: {
          start: '2026-04-05',
          end: '2026-05-01',
        },
      },
      validationIssues: [],
    });

    const invalid = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'boundary_adjustment',
        recordId: 'rsp_edit_request',
        updatedServicePeriod: {
          start: '2026-03-28',
          end: '2026-05-01',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-03-28',
          end: '2026-05-01',
          semantics: 'half_open',
        },
      },
      context: {
        editedAt: '2026-03-18T20:05:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'edit-request-invalid',
      },
      siblingRecords: [
        buildRecurringServicePeriodRecord({
          recordId: 'rsp_before',
          servicePeriod: {
            start: '2026-03-01',
            end: '2026-04-01',
            semantics: 'half_open',
          },
          invoiceWindow: {
            start: '2026-03-01',
            end: '2026-04-01',
            semantics: 'half_open',
          },
        }),
      ],
    });

    expect(invalid).toEqual({
      ok: false,
      operation: 'boundary_adjustment',
      recordId: 'rsp_edit_request',
      validationIssues: [
        {
          code: 'continuity_overlap_before',
          field: 'servicePeriod',
          message: 'Edit would create a service-period overlap before period:2025-01-01:2025-02-01: previous period ends 2026-04-01.',
        },
      ],
    });
  });

  it('T296: skip or defer operations mark future persisted service periods without corrupting continuity or invoice linkage', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_skip_request',
      servicePeriod: {
        start: '2026-05-01',
        end: '2026-06-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-05-01',
        end: '2026-06-01',
        semantics: 'half_open',
      },
    });

    const skipped = applyRecurringServicePeriodEditRequest({
      record,
      request: {
        operation: 'skip',
        recordId: 'rsp_skip_request',
      },
      context: {
        editedAt: '2026-03-18T20:10:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'skip-request',
      },
    });

    expect(skipped).toMatchObject({
      ok: true,
      operation: 'skip',
      recordId: 'rsp_skip_request',
      editedRecord: {
        lifecycleState: 'skipped',
        provenance: {
          kind: 'user_edited',
          reasonCode: 'skip',
        },
      },
      validationIssues: [],
    });

    const linkedBilledRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_linked_billed',
      lifecycleState: 'billed',
      invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage(),
    });

    const linkedFailure = applyRecurringServicePeriodEditRequest({
      record: linkedBilledRecord,
      request: {
        operation: 'defer',
        recordId: 'rsp_linked_billed',
        deferredInvoiceWindow: {
          start: '2026-06-01',
          end: '2026-07-01',
          semantics: 'half_open',
        },
      },
      context: {
        editedAt: '2026-03-18T20:15:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'defer-request-linked',
      },
    });

    expect(linkedFailure).toEqual({
      ok: false,
      operation: 'defer',
      recordId: 'rsp_linked_billed',
      validationIssues: [
        {
          code: 'immutable_record',
          field: 'operation',
          message: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
        },
      ],
    });
  });
});
