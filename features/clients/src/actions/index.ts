/**
 * Client server actions
 *
 * These are Next.js server actions for client operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createClientRepository } from '../repositories/index.js';
import {
  createCompanySchema,
  updateCompanySchema,
  type Company,
  type CompanyFilters,
  type CompanyListResponse,
  type CreateCompanyInput,
  type UpdateCompanyInput,
  type CompanyWithLocation,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a paginated list of clients for the current tenant
 */
export async function getClients(
  context: ActionContext,
  filters: CompanyFilters = {}
): Promise<CompanyListResponse> {
  const repo = createClientRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get all clients (unpaginated) for the current tenant
 */
export async function getAllClients(
  context: ActionContext,
  includeInactive: boolean = true
): Promise<Company[]> {
  const repo = createClientRepository(context.knex);
  const filters: CompanyFilters = {
    limit: 10000, // Large limit for "all"
    offset: 0,
  };

  if (!includeInactive) {
    filters.is_inactive = false;
  }

  const result = await repo.findMany(context.tenantId, filters);
  return result.clients;
}

/**
 * Get a single client by ID
 */
export async function getClient(
  context: ActionContext,
  clientId: string
): Promise<CompanyWithLocation | null> {
  const repo = createClientRepository(context.knex);
  return repo.findById(context.tenantId, clientId);
}

/**
 * Get a client by ID (alias for getClient)
 */
export async function getClientById(
  context: ActionContext,
  clientId: string
): Promise<CompanyWithLocation | null> {
  return getClient(context, clientId);
}

/**
 * Create a new client
 */
export async function createClient(
  context: ActionContext,
  input: CreateCompanyInput
): Promise<{ success: true; data: Company } | { success: false; error: string }> {
  // Validate input
  const validation = createCompanySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createClientRepository(context.knex);
    const client = await repo.create(context.tenantId, validation.data);
    return { success: true, data: client };
  } catch (error: any) {
    console.error('[clients/actions] Failed to create client:', error);

    // Handle specific database constraint violations
    if (error.code === '23505') {
      // PostgreSQL unique constraint violation
      if (error.constraint && error.constraint.includes('clients_tenant_client_name_unique')) {
        return {
          success: false,
          error: `A client with the name "${input.client_name}" already exists. Please choose a different name.`,
        };
      } else {
        return {
          success: false,
          error: 'A client with these details already exists. Please check the client name.',
        };
      }
    }

    if (error.code === '23514') {
      // Check constraint violation
      return {
        success: false,
        error: 'Invalid data provided. Please check all fields and try again.',
      };
    }

    if (error.code === '23503') {
      // Foreign key constraint violation
      return {
        success: false,
        error: 'Referenced data not found. Please check account manager selection.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create client',
    };
  }
}

/**
 * Update an existing client
 */
export async function updateClient(
  context: ActionContext,
  clientId: string,
  input: Partial<UpdateCompanyInput>
): Promise<{ success: true; data: Company } | { success: false; error: string }> {
  // Validate input
  const validation = updateCompanySchema.safeParse({ ...input, client_id: clientId });
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createClientRepository(context.knex);
    const client = await repo.update(context.tenantId, validation.data);

    if (!client) {
      return { success: false, error: 'Client not found' };
    }

    return { success: true, data: client };
  } catch (error) {
    console.error('[clients/actions] Failed to update client:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update client',
    };
  }
}

/**
 * Delete a client (soft delete)
 */
export async function deleteClient(
  context: ActionContext,
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createClientRepository(context.knex);

    // Check if the client exists
    const client = await repo.findById(context.tenantId, clientId);
    if (!client) {
      return { success: false, error: 'Client not found' };
    }

    // TODO: Add dependency checks (contacts, tickets, projects, etc.)
    // For now, just perform the soft delete
    const deleted = await repo.delete(context.tenantId, clientId);

    if (!deleted) {
      return { success: false, error: 'Client not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[clients/actions] Failed to delete client:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete client',
    };
  }
}

/**
 * Check if clients with given names already exist
 */
export async function checkExistingClients(
  context: ActionContext,
  clientNames: string[]
): Promise<Company[]> {
  const { knex, tenantId } = context;

  const existingClients = await knex('clients')
    .select('*')
    .whereIn('client_name', clientNames)
    .andWhere('tenant', tenantId);

  return existingClients;
}

/**
 * Get all client IDs matching filters
 */
export async function getAllClientIds(
  context: ActionContext,
  filters: CompanyFilters = {}
): Promise<string[]> {
  const repo = createClientRepository(context.knex);
  const result = await repo.findMany(context.tenantId, {
    ...filters,
    limit: 10000,
    offset: 0,
  });
  return result.clients.map((c) => c.client_id);
}
