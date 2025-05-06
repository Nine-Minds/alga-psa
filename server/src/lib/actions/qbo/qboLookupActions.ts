// server/src/lib/actions/qbo/qboLookupActions.ts

import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry';

const registry = getActionRegistry();
const QBO_INTEGRATION_TYPE = 'quickbooks_online';

// --- Action Parameters Interfaces ---

interface LookupQboItemIdParams {
  alga_service_id: string;
  realmId: string; // QBO Realm ID is required for QBO lookups
}

interface LookupQboTaxCodeIdParams {
  alga_tax_region: string; // Assuming tax region maps to QBO TaxCode
  realmId: string;
}

interface LookupQboTermIdParams {
  alga_payment_terms: string; // Assuming payment terms map to QBO Term
  realmId: string;
}

// --- Action Parameter Definitions ---

const lookupQboItemIdParamsDef: ActionParameterDefinition[] = [
  { name: 'alga_service_id', type: 'string', required: true, description: 'The Alga Service ID to look up' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID' },
];

const lookupQboTaxCodeIdParamsDef: ActionParameterDefinition[] = [
  { name: 'alga_tax_region', type: 'string', required: true, description: 'The Alga Tax Region to look up' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID' },
];

const lookupQboTermIdParamsDef: ActionParameterDefinition[] = [
  { name: 'alga_payment_terms', type: 'string', required: true, description: 'The Alga Payment Terms to look up' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID' },
];

// --- Action Implementations ---

/**
 * Workflow Action: Looks up the QBO Item ID corresponding to an Alga Service ID.
 * Wraps the generic external:lookupEntityId action.
 */
async function lookupQboItemIdAction(params: Record<string, any>, context: ActionExecutionContext): Promise<{ qbo_item_id: string | null }> {
  const validatedParams = params as LookupQboItemIdParams;
  const { alga_service_id, realmId } = validatedParams;
  const { tenant } = context; // Access tenant from ActionExecutionContext

  console.log(`[QBO Lookup Action] Looking up Item ID for Service ID: ${alga_service_id}, Realm: ${realmId}, Tenant: ${tenant}`);

  // The generic action is registered with the name 'external:lookupEntityId'
  // We need access to the registry's executeAction method, but actions typically call other actions via context.actions
  // However, ActionExecutionContext doesn't have context.actions.
  // This implies lookups might need to be handled differently, perhaps directly using the DB logic
  // or the generic action needs to be callable in a different way.
  // For now, let's assume we *can* call the generic action somehow, maybe via a direct import and execution simulation.
  // *** This needs clarification based on how actions call other actions in this system ***

  // --- Simulation/Placeholder ---
  // In a real scenario, this would likely involve calling the registered 'external:lookupEntityId' action.
  // Since we can't easily do that from here without the full WorkflowContext, we simulate the expected outcome.
  console.warn("[QBO Lookup Action] Placeholder: Simulating call to 'external:lookupEntityId' for Item lookup.");
  // Simulate calling the generic lookup
  const lookupParams = {
      integration_type: QBO_INTEGRATION_TYPE,
      alga_entity_type: 'item', // Specific type for QBO Item
      alga_entity_id: alga_service_id,
      external_realm_id: realmId,
  };
  // Simulate result - replace with actual call if possible
  // const result = await registry.executeAction('external:lookupEntityId', { ...context, parameters: lookupParams });
  const simulatedResult = { external_entity_id: `qbo-item-for-${alga_service_id}` }; // Placeholder result
  // --- End Simulation ---

  return { qbo_item_id: simulatedResult.external_entity_id };
}

/**
 * Workflow Action: Looks up the QBO TaxCode ID corresponding to an Alga Tax Region.
 * Wraps the generic external:lookupEntityId action.
 */
async function lookupQboTaxCodeIdAction(params: Record<string, any>, context: ActionExecutionContext): Promise<{ qbo_tax_code_id: string | null }> {
    const validatedParams = params as LookupQboTaxCodeIdParams;
    const { alga_tax_region, realmId } = validatedParams;
    const { tenant } = context;

    console.log(`[QBO Lookup Action] Looking up TaxCode ID for Tax Region: ${alga_tax_region}, Realm: ${realmId}, Tenant: ${tenant}`);
    console.warn("[QBO Lookup Action] Placeholder: Simulating call to 'external:lookupEntityId' for TaxCode lookup.");

    const lookupParams = {
        integration_type: QBO_INTEGRATION_TYPE,
        alga_entity_type: 'tax_code', // Specific type for QBO TaxCode
        alga_entity_id: alga_tax_region, // Assuming region name/ID is the key
        external_realm_id: realmId,
    };
    // const result = await registry.executeAction('external:lookupEntityId', { ...context, parameters: lookupParams });
    const simulatedResult = { external_entity_id: `qbo-taxcode-for-${alga_tax_region}` }; // Placeholder

    return { qbo_tax_code_id: simulatedResult.external_entity_id };
}

/**
 * Workflow Action: Looks up the QBO Term ID corresponding to Alga Payment Terms.
 * Wraps the generic external:lookupEntityId action.
 */
async function lookupQboTermIdAction(params: Record<string, any>, context: ActionExecutionContext): Promise<{ qbo_term_id: string | null }> {
    const validatedParams = params as LookupQboTermIdParams;
    const { alga_payment_terms, realmId } = validatedParams;
    const { tenant } = context;

    console.log(`[QBO Lookup Action] Looking up Term ID for Payment Terms: ${alga_payment_terms}, Realm: ${realmId}, Tenant: ${tenant}`);
    console.warn("[QBO Lookup Action] Placeholder: Simulating call to 'external:lookupEntityId' for Term lookup.");

    const lookupParams = {
        integration_type: QBO_INTEGRATION_TYPE,
        alga_entity_type: 'term', // Specific type for QBO Term
        alga_entity_id: alga_payment_terms, // Assuming terms name/ID is the key
        external_realm_id: realmId,
    };
    // const result = await registry.executeAction('external:lookupEntityId', { ...context, parameters: lookupParams });
    const simulatedResult = { external_entity_id: `qbo-term-for-${alga_payment_terms}` }; // Placeholder

    return { qbo_term_id: simulatedResult.external_entity_id };
}


// --- Action Registration ---

registry.registerSimpleAction(
  'qbo:lookupItemId',
  'Looks up a QBO Item ID from an Alga Service ID',
  lookupQboItemIdParamsDef,
  lookupQboItemIdAction
);

registry.registerSimpleAction(
  'qbo:lookupTaxCodeId',
  'Looks up a QBO TaxCode ID from an Alga Tax Region',
  lookupQboTaxCodeIdParamsDef,
  lookupQboTaxCodeIdAction
);

registry.registerSimpleAction(
  'qbo:lookupTermId',
  'Looks up a QBO Term ID from Alga Payment Terms',
  lookupQboTermIdParamsDef,
  lookupQboTermIdAction
);