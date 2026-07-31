/**
 * @alga-psa/clients
 *
 * Client management module for Alga PSA.
 * Provides client CRUD operations, validation schemas, and UI components.
 */

// Models
export { Client } from './models';

// Schemas
export {
  ClientPropertiesSchema,
  ClientLifecycleStatusSchema,
  ClientSchema,
  CreateClientSchema,
  UpdateClientSchema,
} from './schemas';

export type {
  Client as ClientType,
  CreateClientInput,
  UpdateClientInput,
} from './schemas';

// Re-export types from @alga-psa/types for convenience
export type { IClient, CreateClientInput as ICreateClientInput, UpdateClientInput as IUpdateClientInput } from '@alga-psa/types';

// Client data normalization
export {
  InvalidClientTypeError,
  normalizeClientType,
} from './lib/normalizeClientType';
export type { NormalizedClientType } from './lib/normalizeClientType';

// Components
export * from './components';

// Hooks
export * from './hooks';
