/**
 * The user response allow-list lives in @alga-psa/types so lower-level packages
 * (tickets, ...) can share it without a dependency cycle through @alga-psa/users.
 * This module keeps the original import path working.
 */
export {
  USER_RESPONSE_FIELD_NAMES,
  USER_RESPONSE_COLUMNS,
  API_USER_CONTEXT_COLUMNS,
  SENSITIVE_USER_FIELDS,
  sanitizeUserForResponse,
} from '@alga-psa/types';
export type { AllowlistedUserField, SafeApiUser, SensitiveUserField } from '@alga-psa/types';
