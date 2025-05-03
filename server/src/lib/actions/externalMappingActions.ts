// server/src/lib/actions/externalMappingActions.ts

import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry';
import { createTenantKnex } from 'server/src/lib/db'; // Assuming path based on coding standards

const registry = getActionRegistry();

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

    const query = knex('tenant_external_entity_mappings')
      .select('external_entity_id')
      .where({
        tenant_id: tenant, // Ensure tenant isolation
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

    const result = await query;

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

registry.registerSimpleAction(
  'external:lookupEntityId',
  'Looks up an external entity ID from an Alga entity ID using the generic mapping table',
  lookupExternalEntityIdParamsDef,
  lookupExternalEntityIdAction
);