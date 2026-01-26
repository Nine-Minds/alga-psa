/**
 * @alga-psa/clients
 *
 * Main entry point exports buildable lib/models/schemas code only.
 * For runtime code, use:
 * - '@alga-psa/clients/actions' for server actions
 * - '@alga-psa/clients/components' for React components
 * - '@alga-psa/clients/hooks' for React hooks
 */

// Models (buildable)
export { default as Client } from './models/client';
export { default as ClientContract } from './models/clientContract';
export { default as ClientContractLine } from './models/clientContractLine';
export { default as InteractionModel } from './models/interactions';

// Schemas (buildable)
export {
  ClientPropertiesSchema,
  ClientSchema,
  CreateClientSchema,
  UpdateClientSchema,
} from './schemas';

export type {
  Client as ClientType,
  CreateClientInput,
  UpdateClientInput,
} from './schemas';

// Lib utilities (buildable)
export * from './lib/clientContractWorkflowEvents';

// Re-export types from @alga-psa/types for convenience
export type { IClient, CreateClientInput as ICreateClientInput, UpdateClientInput as IUpdateClientInput } from '@alga-psa/types';
