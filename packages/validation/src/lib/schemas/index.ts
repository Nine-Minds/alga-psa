/**
 * @alga-psa/validation - Schema Index
 *
 * Re-exports common schemas from utils.
 * Entity-specific schemas will be added as they are migrated from vertical slice modules.
 */

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

// Entity-specific schemas will be added here as they are migrated
// e.g., export * from './client.schema';
// e.g., export * from './ticket.schema';
