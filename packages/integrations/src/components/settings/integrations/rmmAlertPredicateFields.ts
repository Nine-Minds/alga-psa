import type { PredicateOperator } from '@alga-psa/predicates';
import type { PredicateFieldDescriptor } from './RmmAlertPredicateEditor';

const set = ['in', 'not_in', 'equals', 'not_equals'] as const satisfies readonly PredicateOperator[];
const name = ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] as const satisfies readonly PredicateOperator[];

/** RMM's schema-backed field catalog; the editor itself remains domain agnostic. */
export const RMM_ALERT_PREDICATE_FIELDS: readonly PredicateFieldDescriptor[] = [
  { path: 'severity', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.severity', label: 'Severity', operators: set },
  { path: 'alertClass', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.alertClass', label: 'Alert class', operators: [...set, 'contains_ci', 'not_contains_ci'] },
  { path: 'activityType', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.activityType', label: 'Activity type', operators: [...set, 'contains_ci', 'not_contains_ci'] },
  { path: 'sourceType', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.sourceType', label: 'Source type', operators: [...set, 'contains_ci', 'not_contains_ci'] },
  { path: 'organizationId', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.organizationId', label: 'Organization ID', operators: set },
  { path: 'message', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.message', label: 'Message', operators: ['contains_ci', 'not_contains_ci'] },
  { path: 'details', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.details', label: 'Details', operators: ['contains_ci', 'not_contains_ci'] },
  { path: 'text', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.text', label: 'Message and details', operators: ['contains_ci', 'not_contains_ci'] },
  { path: 'deviceName', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.deviceName', label: 'Device name', operators: name },
  { path: 'externalDeviceId', labelKey: 'integrations.rmm.alertAutomation.predicate.fields.externalDeviceId', label: 'External device ID', operators: set },
];
