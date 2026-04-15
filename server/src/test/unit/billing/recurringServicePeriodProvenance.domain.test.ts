import { describe, expect, it } from 'vitest';

import type { IRecurringServicePeriodRecordProvenance } from '@alga-psa/types';
import { RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES } from '@alga-psa/types';
import {
  isRecurringServicePeriodProvenanceDivergent,
  isRecurringServicePeriodProvenanceReasonCode,
  validateRecurringServicePeriodProvenance,
} from '@alga-psa/shared/billingClients/recurringServicePeriodProvenance';

describe('recurring service-period provenance domain', () => {
  it('T284: persisted provenance distinguishes untouched generated periods from divergent user-edited and regenerated periods while retaining the reason for divergence', () => {
    expect(RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.user_edited).toContain('boundary_adjustment');
    expect(RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.regenerated).toContain('billing_schedule_changed');

    const generated: IRecurringServicePeriodRecordProvenance = {
      kind: 'generated',
      sourceRuleVersion: 'contract-line-1:v1',
      reasonCode: 'initial_materialization',
      sourceRunKey: 'materialize-2026-03-18',
    };

    const userEdited: IRecurringServicePeriodRecordProvenance = {
      kind: 'user_edited',
      sourceRuleVersion: 'contract-line-1:v1',
      reasonCode: 'boundary_adjustment',
      supersedesRecordId: 'rsp_01',
    };

    const regenerated: IRecurringServicePeriodRecordProvenance = {
      kind: 'regenerated',
      sourceRuleVersion: 'contract-line-1:v2',
      reasonCode: 'billing_schedule_changed',
      sourceRunKey: 'regenerate-2026-03-18',
      supersedesRecordId: 'rsp_02',
    };

    expect(isRecurringServicePeriodProvenanceDivergent(generated)).toBe(false);
    expect(isRecurringServicePeriodProvenanceDivergent(userEdited)).toBe(true);
    expect(isRecurringServicePeriodProvenanceDivergent(regenerated)).toBe(true);

    expect(isRecurringServicePeriodProvenanceReasonCode('user_edited', 'boundary_adjustment')).toBe(true);
    expect(isRecurringServicePeriodProvenanceReasonCode('generated', 'boundary_adjustment')).toBe(false);

    expect(validateRecurringServicePeriodProvenance(generated)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateRecurringServicePeriodProvenance(userEdited)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateRecurringServicePeriodProvenance(regenerated)).toEqual({
      valid: true,
      errors: [],
    });

    const invalidEdited: IRecurringServicePeriodRecordProvenance = {
      kind: 'user_edited',
      sourceRuleVersion: 'contract-line-1:v1',
      reasonCode: 'skip',
      supersedesRecordId: '',
    };

    expect(validateRecurringServicePeriodProvenance(invalidEdited)).toEqual({
      valid: false,
      errors: ['User-edited provenance requires supersedesRecordId'],
    });
  });
});
