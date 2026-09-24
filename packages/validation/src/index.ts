/**
 * @alga-psa/validation
 *
 * Validation utilities and Zod schemas for AlgaPSA.
 * Provides centralized validation logic for use across all modules.
 */

// Validation utilities
export {
  isValidEmail,
  validateData,
  validateArray,
  isValidUUID,
  validateTenantAccess
} from './lib/utils';

// Type exports
export type { ISO8601String } from './lib/utils';

// Common Zod schemas
export {
  iso8601Schema,
  plainDateSchema,
  tenantSchema,
  uuidSchema,
  nonEmptyStringSchema,
  emailSchema,
  optionalEmailSchema,
  phoneSchema,
  currencyCodeSchema,
  paginationSchema
} from './lib/utils';

// Re-export zod for convenience
export { z } from 'zod';

// Client-side validation helpers used by UI/forms
export * from './lib/clientFormValidation';

// Three-layer field validation result shape (normalize → validate → advise)
export {
  buildFieldValidation,
  message,
  translateFieldValidation,
  translateMessage
} from './lib/fieldValidation';
export type { FieldValidation, Translator, ValidationMessage } from './lib/fieldValidation';

// Phone normalization (libphonenumber-js)
export {
  normalizePhone,
  isDialPrefixOnly,
  isStructurallyValidPhone,
  splitPackedExtension,
  PHONE_EXTENSION_MAX_LENGTH
} from './lib/phone';
export type { NormalizedPhone, NormalizePhoneOptions, PhoneNormalizationError } from './lib/phone';

// Single structural authority for client + contact fields
export {
  CLIENT_CONTACT_FIELD_LIMITS,
  clientCoreFieldsSchema,
  clientCoreFieldsUpdateSchema,
  clientLocationCoreFieldsSchema,
  clientLocationCoreFieldsUpdateSchema,
  clientNameSchema,
  contactCoreFieldsSchema,
  contactCoreFieldsUpdateSchema,
  contactNameSchema,
  emailFieldSchema,
  isUnchangedFromStored,
  parseSubmittedFields,
  parseUrl,
  phoneExtensionSchema,
  phoneFieldSchema,
  urlFieldSchema,
  withDefaultScheme
} from './lib/schemas/clientContact.schema';
export type {
  ClientCoreFields,
  ClientLocationCoreFields,
  ContactCoreFields,
  StructuralParseResult
} from './lib/schemas/clientContact.schema';

// Password policy (auth concern, kept separate from form-field validators)
export { validatePassword, getPasswordRequirements } from './lib/passwordValidation';

// Shared password policy as a Zod schema (delegates to validatePassword)
export { passwordSchema } from './lib/schemas';

// Tenant slug utilities
export {
  buildTenantPortalSlug,
  isValidTenantSlug,
  getSlugParts,
  TENANT_SLUG_REGEX
} from './lib/tenantSlug';
