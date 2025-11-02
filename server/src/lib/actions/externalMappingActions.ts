'use server';
// server/src/lib/actions/externalMappingActions.ts

import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@alga-psa/shared/workflow/core';
import { createTenantKnex } from 'server/src/lib/db'; // Assuming path based on coding standards
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'; // For tenant context
import { Knex } from 'knex'; // Import Knex type
import { hasPermission } from 'server/src/lib/auth/rbac';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

// --- Types based on schema from QBO Integration Project Plan.md (Section 6.1) ---

export interface ExternalEntityMapping {
  id: string; // UUID
  tenant: string; // UUID
  integration_type: string; // VARCHAR(50)
  alga_entity_type: string; // VARCHAR(50)
  alga_entity_id: string; // VARCHAR(255)
  external_entity_id: string; // VARCHAR(255)
  external_realm_id?: string | null; // VARCHAR(255)
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null; // VARCHAR(20)
  last_synced_at?: string | null; // TIMESTAMPTZ (ISO8601 String)
  metadata?: object | null; // JSONB
  created_at: string; // TIMESTAMPTZ (ISO8601 String)
  updated_at: string; // TIMESTAMPTZ (ISO8601 String)
}

interface GetMappingsParams {
  integrationType?: string;
  algaEntityType?: string;
  externalRealmId?: string;
  // Add other potential filters based on the schema if needed
  algaEntityId?: string;
  externalEntityId?: string;
}

export interface CreateMappingData {
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  metadata?: object | null;
}

export interface UpdateMappingData {
  external_entity_id?: string;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  metadata?: object | null;
  external_realm_id?: string | null;
  // Add other updatable fields as needed, ensuring they are safe to update
  // Avoid updating alga_entity_id, integration_type etc. directly, prefer delete/create
}

// --- Helper Function for Tenant Context ---

async function getTenantContext(): Promise<{ tenantId: string; knex: Knex; user: IUserWithRoles }> {
  const user = await getCurrentUser();
  // Corrected based on TS error: Use user.tenant
  if (!user?.tenant) {
    throw new Error('User or Tenant ID not found. Unable to perform tenant-scoped operation.');
  }
  const { knex } = await createTenantKnex(); // Gets Knex instance
  // Corrected based on TS error: Use user.tenant
  return { tenantId: user.tenant, knex, user };
}

// --- CRUD Server Actions ---

/**
 * Retrieves a list of external entity mappings for the current user's tenant,
 * with optional filtering.
 */
export async function getExternalEntityMappings(params: GetMappingsParams): Promise<ExternalEntityMapping[]> {
  const { tenantId, knex, user } = await getTenantContext();
  const allowed = await hasPermission(user, 'billing_settings', 'read', knex);
  if (!allowed) {
    throw new Error('Forbidden');
  }
  const { integrationType, algaEntityType, externalRealmId, algaEntityId, externalEntityId } = params;

  console.log(`[External Mapping Action - Server] Getting mappings for tenant ${tenantId} with filters:`, params);

  try {
    const mappings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ tenant: tenantId }); // **Tenant Isolation**

      if (integrationType) {
        query.andWhere({ integration_type: integrationType });
      }
      if (algaEntityType) {
        query.andWhere({ alga_entity_type: algaEntityType });
      }
      if (algaEntityId) {
        query.andWhere({ alga_entity_id: algaEntityId });
      }
      if (externalEntityId) {
        query.andWhere({ external_entity_id: externalEntityId });
      }

      // Handle external_realm_id filtering (including null/empty cases if needed)
      if (externalRealmId !== undefined) {
        if (externalRealmId === null || externalRealmId === '') {
          query.andWhere(function() {
            this.whereNull('external_realm_id').orWhere('external_realm_id', '');
          });
        } else {
          query.andWhere({ external_realm_id: externalRealmId });
        }
      }

      return await query.select('*');
    });
    console.log(`[External Mapping Action - Server] Found ${mappings.length} mappings for tenant ${tenantId}.`);
    return mappings;

  } catch (error: any) {
    console.error(`[External Mapping Action - Server] Error getting mappings for tenant ${tenantId}: ${error.message}`, error);
    throw new Error(`Failed to retrieve external entity mappings: ${error.message}`);
  }
}

/**
 * Creates a new external entity mapping for the current user's tenant.
 */
export async function createExternalEntityMapping(mappingData: CreateMappingData): Promise<ExternalEntityMapping> {
  const { tenantId, knex, user } = await getTenantContext();
  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    throw new Error('Forbidden');
  }
  const { integration_type, alga_entity_type, alga_entity_id, external_entity_id, external_realm_id, sync_status, metadata } = mappingData;

  console.log(`[External Mapping Action - Server] Creating mapping for tenant ${tenantId}:`, mappingData);

  try {
    const [newMapping] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .insert({
          id: trx.raw('gen_random_uuid()'), // Use DB function for UUID generation
          tenant: tenantId, // **Tenant Isolation**
          integration_type,
          alga_entity_type,
          alga_entity_id,
          external_entity_id,
          external_realm_id: external_realm_id, // Handle null/undefined appropriately
          sync_status: sync_status ?? 'pending', // Default sync status
          metadata: metadata ?? null, // Knex handles JSONB serialization
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*'); // Return the newly created row
    });

    if (!newMapping) {
        throw new Error('Failed to create mapping, insert operation did not return the new record.');
    }

    console.log(`[External Mapping Action - Server] Successfully created mapping with ID ${newMapping.id} for tenant ${tenantId}.`);
    // Ensure metadata is parsed back if needed, though returning should handle it if Knex is configured correctly.
    // If metadata comes back as a string: newMapping.metadata = typeof newMapping.metadata === 'string' ? JSON.parse(newMapping.metadata) : newMapping.metadata;
    return newMapping;

  } catch (error: any) {
    console.error(`[External Mapping Action - Server] Error creating mapping for tenant ${tenantId}: ${error.message}`, error);
    // Check for unique constraint violation (e.g., PostgreSQL error code 23505)
    if (error.code === '23505') {
        throw new Error(`A mapping already exists for this combination (Tenant: ${tenantId}, Integration: ${integration_type}, Alga Type: ${alga_entity_type}, Alga ID: ${alga_entity_id}, External ID: ${external_entity_id}, Realm: ${external_realm_id ?? 'N/A'}).`);
    }
    throw new Error(`Failed to create external entity mapping: ${error.message}`);
  }
}

/**
 * Updates an existing external entity mapping for the current user's tenant.
 */
export async function updateExternalEntityMapping(mappingId: string, updates: UpdateMappingData): Promise<ExternalEntityMapping> {
  const { tenantId, knex, user } = await getTenantContext();

  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    throw new Error('Forbidden');
  }

  if (!mappingId) {
    throw new Error('Mapping ID is required for update.');
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('No update data provided.');
  }

  console.log(`[External Mapping Action - Server] Updating mapping ID ${mappingId} for tenant ${tenantId} with updates:`, updates);

  // Prepare updates. Knex handles JSONB serialization.
  const updatePayload: Partial<ExternalEntityMapping> = { ...updates };
  // Ensure metadata is passed as an object or null
  if (updatePayload.metadata !== undefined) {
      updatePayload.metadata = updatePayload.metadata ?? null;
  }
  // Add updated_at timestamp manually since DB triggers are not supported in Citus
  updatePayload.updated_at = new Date().toISOString();

  try {
    const [updatedMapping] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          id: mappingId,
          tenant: tenantId // **Tenant Isolation**
        })
        .update(updatePayload)
        .returning('*'); // Return the updated row
    });

    if (!updatedMapping) {
      // Attempt to find if the mapping exists at all for this tenant to give a better error
      const exists = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
          .select('id')
          .where({ id: mappingId, tenant: tenantId })
          .first();
      });
      if (!exists) {
          throw new Error(`Mapping with ID ${mappingId} not found for the current tenant (${tenantId}).`);
      } else {
          // This case should ideally not happen if the update payload was valid and the record exists
          throw new Error(`Failed to update mapping ID ${mappingId}. Record exists but update failed.`);
      }
    }

    console.log(`[External Mapping Action - Server] Successfully updated mapping ID ${updatedMapping.id} for tenant ${tenantId}.`);
    // Parse metadata if needed: updatedMapping.metadata = typeof updatedMapping.metadata === 'string' ? JSON.parse(updatedMapping.metadata) : updatedMapping.metadata;
    return updatedMapping;

  } catch (error: any) {
    console.error(`[External Mapping Action - Server] Error updating mapping ID ${mappingId} for tenant ${tenantId}: ${error.message}`, error);
    throw new Error(`Failed to update external entity mapping: ${error.message}`);
  }
}

/**
 * Deletes an external entity mapping for the current user's tenant.
 */
export async function deleteExternalEntityMapping(mappingId: string): Promise<void> {
  const { tenantId, knex, user } = await getTenantContext();

  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    throw new Error('Forbidden');
  }

  if (!mappingId) {
    throw new Error('Mapping ID is required for deletion.');
  }

  console.log(`[External Mapping Action - Server] Deleting mapping ID ${mappingId} for tenant ${tenantId}.`);

  try {
    const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          id: mappingId,
          tenant: tenantId // **Tenant Isolation**
        })
        .del(); // Perform the delete operation
    });

    if (deletedCount === 0) {
      // Check if the mapping ID exists at all to differentiate between "not found" and other errors
       const exists = await withTransaction(knex, async (trx: Knex.Transaction) => {
         return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
           .select('id')
           .where({ id: mappingId, tenant: tenantId })
           .first();
       });
       if (!exists) {
           console.warn(`[External Mapping Action - Server] Mapping ID ${mappingId} not found for tenant ${tenantId}. No deletion occurred.`);
           // Depending on requirements, might throw an error or just return successfully
           // throw new Error(`Mapping with ID ${mappingId} not found for the current tenant (${tenantId}).`);
           return; // Treat as success if not found is acceptable
       } else {
           // This case implies the record exists but wasn't deleted, which is unusual for a simple delete
           throw new Error(`Failed to delete mapping ID ${mappingId}. Record exists but deletion failed.`);
       }
    }

    console.log(`[External Mapping Action - Server] Successfully deleted mapping ID ${mappingId} for tenant ${tenantId}.`);

  } catch (error: any) {
    console.error(`[External Mapping Action - Server] Error deleting mapping ID ${mappingId} for tenant ${tenantId}: ${error.message}`, error);
    throw new Error(`Failed to delete external entity mapping: ${error.message}`);
  }
}

// --- Existing Workflow Action Code Below ---


// --- Action Parameters Interface ---

interface LookupExternalEntityIdParams {
  integration_type: string; // e.g., 'quickbooks_online'
  alga_entity_type: string; // e.g., 'item', 'tax_code', 'term', 'customer', 'invoice'
  alga_entity_id: string;   // The ID of the entity in the Alga system
  external_realm_id?: string; // Optional: e.g., QBO Realm ID
}

// --- Action Parameter Definitions ---

const lookupExternalEntityIdParamsDef: ActionParameterDefinition[] = [
  { name: 'integration_type', type: 'string', required: true, description: 'Identifier for the external system (e.g., quickbooks_online)' },
  { name: 'alga_entity_type', type: 'string', required: true, description: 'Type of the entity within the Alga system (e.g., item, tax_code, term)' },
  { name: 'alga_entity_id', type: 'string', required: true, description: 'The unique identifier of the entity within the Alga system' },
  { name: 'external_realm_id', type: 'string', required: false, description: 'Optional identifier for the external system\'s context (e.g., QBO Realm ID)' },
];

// --- Action Implementation ---

/**
 * Workflow Action: Looks up the external system's entity ID based on the Alga entity ID
 * using the tenant_external_entity_mappings table.
 */
async function lookupExternalEntityIdAction(params: Record<string, any>, context: ActionExecutionContext): Promise<{ external_entity_id: string | null }> {
  const validatedParams = params as LookupExternalEntityIdParams;
  const { integration_type, alga_entity_type, alga_entity_id, external_realm_id } = validatedParams;
  const { tenant } = context;

  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[External Mapping Action] Looking up external ID for tenant ${tenant}, integration ${integration_type}, type ${alga_entity_type}, alga_id ${alga_entity_id}, realm ${external_realm_id || 'N/A'}`);

  try {
    const { knex } = await createTenantKnex(); // Get tenant-specific Knex instance

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = trx('tenant_external_entity_mappings')
        .select('external_entity_id')
        .where({
          tenant: tenant, // Ensure tenant isolation
          integration_type: integration_type,
          alga_entity_type: alga_entity_type,
          alga_entity_id: alga_entity_id,
        })
        .first(); // Expecting at most one mapping

      // Add realm ID condition only if it's provided
      if (external_realm_id) {
        query.andWhere('external_realm_id', external_realm_id);
      } else {
        // Handle cases where realm ID might be NULL in the table if it wasn't provided
        query.andWhere(function() {
          this.whereNull('external_realm_id').orWhere('external_realm_id', '');
        });
      }

      return await query;
    });

    const externalId = result?.external_entity_id || null;

    if (externalId) {
      console.log(`[External Mapping Action] Found external ID: ${externalId}`);
    } else {
      console.warn(`[External Mapping Action] No external ID found for tenant ${tenant}, integration ${integration_type}, type ${alga_entity_type}, alga_id ${alga_entity_id}, realm ${external_realm_id || 'N/A'}`);
      // Note: The calling workflow will need to handle the null case (e.g., create human task)
    }

    return { external_entity_id: externalId };

  } catch (error: any) {
    console.error(`[External Mapping Action] Error looking up external ID: ${error.message}`, error);
    // Depending on policy, might return null or re-throw
    // Returning null allows workflow to handle missing mapping explicitly
    // return { external_entity_id: null };
    throw error; // Re-throw for now
  }
}

// --- Action Registration ---
async function performActionRegistration() {
  try {
    const registry = getActionRegistry();

    registry.registerSimpleAction(
      'external:lookupEntityId',
      'Looks up an external entity ID from an Alga entity ID using the generic mapping table',
      lookupExternalEntityIdParamsDef,
      lookupExternalEntityIdAction
    );
    console.log('[External Mapping Action] Action registered successfully.');
  } catch (error) {
    console.error('[External Mapping Action] Error registering action:', error);
  }
}
