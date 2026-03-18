import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  GeneratedRecurringServicePeriodReasonCode,
  IPersistedRecurringObligationRef,
  IRecurringServicePeriodRecord,
  IRecurringServicePeriodRecordProvenance,
  RecurringServicePeriodLifecycleState,
  RecurringServicePeriodProvenanceKind,
  UserEditedRecurringServicePeriodReasonCode,
} from '@alga-psa/types';
import {
  RECURRING_RANGE_SEMANTICS,
  RECURRING_SERVICE_PERIOD_LIFECYCLE_STATES,
  RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS,
  RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES,
} from '@alga-psa/types';

describe('persisted recurring service-period record typing', () => {
  it('T341: shared recurring timing types define the persisted service-period record contract with identifiers, obligation linkage, cadence owner, boundaries, provenance, and lifecycle state', () => {
    expect(RECURRING_SERVICE_PERIOD_LIFECYCLE_STATES).toEqual([
      'generated',
      'edited',
      'skipped',
      'locked',
      'billed',
      'superseded',
      'archived',
    ]);
    expect(RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS).toEqual([
      'generated',
      'user_edited',
      'regenerated',
      'repair',
    ]);
    expect(RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.generated).toEqual([
      'initial_materialization',
      'backfill_materialization',
    ]);

    const lifecycleState: RecurringServicePeriodLifecycleState = 'generated';
    const provenanceKind: RecurringServicePeriodProvenanceKind = 'generated';
    const generatedReasonCode: GeneratedRecurringServicePeriodReasonCode = 'initial_materialization';
    const editedReasonCode: UserEditedRecurringServicePeriodReasonCode = 'boundary_adjustment';

    const sourceObligation: IPersistedRecurringObligationRef = {
      tenant: 'tenant-1',
      obligationId: 'contract-line-1',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    };

    const provenance: IRecurringServicePeriodRecordProvenance = {
      kind: provenanceKind,
      sourceRuleVersion: 'contract-line-1:v1',
      reasonCode: generatedReasonCode,
      sourceRunKey: 'materialize-2026-03-18',
    };

    const record: IRecurringServicePeriodRecord = {
      kind: 'persisted_service_period_record',
      recordId: 'rsp_01',
      scheduleKey: 'schedule:contract-line-1:client:advance',
      periodKey: 'period:2025-01-01:2025-02-01',
      revision: 1,
      sourceObligation,
      cadenceOwner: 'client',
      duePosition: 'advance',
      lifecycleState,
      servicePeriod: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      invoiceWindow: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      activityWindow: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      timingMetadata: {
        anchorDate: '2025-01-01',
        boundarySource: 'client_billing_cycle',
      },
      provenance,
      createdAt: '2026-03-18T10:00:00.000Z',
      updatedAt: '2026-03-18T10:00:00.000Z',
    };

    expect(record.scheduleKey).toContain('contract-line-1');
    expect(record.provenance.kind).toBe('generated');
    expect(record.provenance.reasonCode).toBe('initial_materialization');
    expect(record.lifecycleState).toBe('generated');
    expect(record.servicePeriod.semantics).toBe(RECURRING_RANGE_SEMANTICS);
    expect(record.sourceObligation.tenant).toBe('tenant-1');
    expect(editedReasonCode).toBe('boundary_adjustment');

    expectTypeOf<IRecurringServicePeriodRecord['sourceObligation']>().toEqualTypeOf<IPersistedRecurringObligationRef>();
    expectTypeOf<IRecurringServicePeriodRecord['lifecycleState']>().toEqualTypeOf<RecurringServicePeriodLifecycleState>();
    expectTypeOf<IRecurringServicePeriodRecord['provenance']>().toEqualTypeOf<IRecurringServicePeriodRecordProvenance>();
  });
});
