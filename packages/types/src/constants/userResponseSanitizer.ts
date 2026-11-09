// Compatibility path for callers that import the user-response allow-list from
// constants. Keep its implementation and exported types centralized in lib.
export {
  USER_RESPONSE_FIELD_NAMES,
  USER_RESPONSE_COLUMNS,
  API_USER_CONTEXT_COLUMNS,
  SENSITIVE_USER_FIELDS,
  sanitizeUserForResponse,
} from '../lib/userResponse';
export type { AllowlistedUserField, SafeApiUser, SensitiveUserField } from '../lib/userResponse';
