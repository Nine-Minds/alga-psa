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
