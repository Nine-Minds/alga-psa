/**
 * @alga-psa/validation - Schema Index
 *
 * Re-exports common schemas from utils.
 * Entity-specific schemas will be added as they are migrated from vertical slice modules.
 */

import { z } from 'zod';
import { validatePassword } from '../passwordValidation';

// Re-export common schemas from utils
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
} from '../utils';

/**
 * Single source of truth for the password policy as a Zod schema.
 * Delegates to validatePassword() so UI, API, and server enforce identical rules
 * (length, character classes, common-word blocklist, and long-sequence rejection).
 */
export const passwordSchema = z.string().superRefine((value, ctx) => {
  const error = validatePassword(value);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
});

// Entity-specific schemas will be added here as they are migrated
// e.g., export * from './client.schema';
// e.g., export * from './ticket.schema';
