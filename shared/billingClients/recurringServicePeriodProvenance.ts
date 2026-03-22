import type {
  IRecurringServicePeriodRecordProvenance,
  RecurringServicePeriodProvenanceKind,
  RecurringServicePeriodProvenanceReasonCode,
} from '@alga-psa/types';
import { RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES } from '@alga-psa/types';

export function isRecurringServicePeriodProvenanceReasonCode(
  kind: RecurringServicePeriodProvenanceKind,
  reasonCode: string,
): reasonCode is RecurringServicePeriodProvenanceReasonCode {
  return (
    RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES[kind] as readonly string[]
  ).includes(reasonCode);
}

export function isRecurringServicePeriodProvenanceDivergent(
  provenance: IRecurringServicePeriodRecordProvenance,
) {
  return provenance.kind !== 'generated';
}

export function validateRecurringServicePeriodProvenance(
  provenance: IRecurringServicePeriodRecordProvenance,
) {
  const errors: string[] = [];

  if (!isRecurringServicePeriodProvenanceReasonCode(provenance.kind, provenance.reasonCode)) {
    errors.push(`Unsupported reason code "${provenance.reasonCode}" for provenance kind "${provenance.kind}"`);
  }

  switch (provenance.kind) {
    case 'generated':
      if (!provenance.sourceRunKey) {
        errors.push('Generated provenance requires sourceRunKey');
      }
      if (provenance.supersedesRecordId != null) {
        errors.push('Generated provenance must not supersede an earlier record');
      }
      break;
    case 'user_edited':
      if (!provenance.supersedesRecordId) {
        errors.push('User-edited provenance requires supersedesRecordId');
      }
      break;
    case 'regenerated':
      if (!provenance.sourceRunKey) {
        errors.push('Regenerated provenance requires sourceRunKey');
      }
      if (!provenance.supersedesRecordId) {
        errors.push('Regenerated provenance requires supersedesRecordId');
      }
      break;
    case 'repair':
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
