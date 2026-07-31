/**
 * @alga-psa/validation
 *
 * Validation utilities and Zod schemas for Alga PSA.
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
