// server/src/lib/actions/qbo/qboCustomerActions.ts

// Removed Zod import
import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry'; // Corrected path, added ActionParameterDefinition and ActionExecutionContext
// Removed WorkflowContext import as actions receive ActionExecutionContext
import { QboCustomer } from './types'; // Removed QboTenantCredentials, QboQueryResponse, QboEntityResponse
import { getQboClient } from '@server/lib/qbo/qboClientService'; // Corrected import path
// Removed non-existent WorkflowError import
const registry = getActionRegistry(); // Get the singleton instance
// Removed unused WorkflowContext import

// --- Action Parameters Interfaces (kept for internal type safety) ---

interface CreateQboCustomerParams {
  customerData: Omit<QboCustomer, 'Id' | 'SyncToken' | 'MetaData'> & { PaymentTerms?: string }; // Allow PaymentTerms for lookup
  realmId: string; // Added realmId
}

interface UpdateQboCustomerParams {
  qboCustomerId: string;
  syncToken: string;
  customerData: Omit<QboCustomer, 'Id' | 'SyncToken' | 'MetaData'> & { PaymentTerms?: string }; // Allow PaymentTerms for lookup
  realmId: string; // Added realmId
}

interface GetQboCustomerParams {
  query: string;
  fields?: string;
  realmId: string; // Added realmId
}

// --- Action Parameter Definitions (for registration) ---

const createQboCustomerParamsDef: ActionParameterDefinition[] = [
  { name: 'customerData', type: 'object', required: true, description: 'QBO Customer object data (mapped from Alga, may include PaymentTerms for lookup)' },
];

const updateQboCustomerParamsDef: ActionParameterDefinition[] = [
  { name: 'qboCustomerId', type: 'string', required: true, description: 'The QBO ID of the customer to update' },
  { name: 'syncToken', type: 'string', required: true, description: 'The QBO SyncToken for optimistic locking' },
  { name: 'customerData', type: 'object', required: true, description: 'QBO Customer object data (mapped from Alga, may include PaymentTerms for lookup)' },
];

const getQboCustomerParamsDef: ActionParameterDefinition[] = [
  { name: 'query', type: 'string', required: true, description: 'The QBO Query Language (QL) WHERE clause (e.g., "DisplayName = \'Acme Corp\'")' },
  { name: 'fields', type: 'string', required: false, description: 'Comma-separated list of fields to return (defaults to *)' },
];


// --- Action Implementations ---

/**
 * Workflow Action: Creates a new Customer in QuickBooks Online.
 * Handles tenant isolation, credential retrieval, API call, and basic error handling.
 * Assumes locking/throttling is handled externally or within callQboApi.
 */
// Corrected signature: context is ActionExecutionContext
async function createQboCustomerAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboCustomer> {
  // Use ActionExecutionContext
  const validatedParams = params as CreateQboCustomerParams; // Keep internal type assertion
  const { customerData, realmId } = validatedParams;
  const { tenant } = context; // tenant is directly on ActionExecutionContext

  // Removed checks for context.actions and context.input as they are not used

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    // Should not happen as tenant is required in ActionExecutionContext
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[QBO Action] Starting Create Customer for tenant ${tenant}, realm ${realmId}`);

  // Get the initialized QBO client for this tenant/realm
  const qboClient = await getQboClient(tenant, realmId);

  // Removed Term lookup and human task creation logic - expected to be handled by workflow

  // The workflow is expected to provide customerData with SalesTermRef already mapped (if applicable)
  // and without the temporary PaymentTerms field.
  if ((customerData as any).PaymentTerms) {
      console.warn(`[QBO Action] customerData still contains PaymentTerms field for tenant ${tenant}, realm ${realmId}. This should be removed by the workflow.`);
      // Optionally remove it here as a safeguard, though the workflow should handle it.
      delete (customerData as any).PaymentTerms;
  }

  // Call QBO API with the data provided by the workflow
  const createdCustomer = await qboClient.create<QboCustomer>('Customer', customerData);

    // Basic validation on the response from the service
    if (!createdCustomer?.Id) {
        throw new Error('QBO Create Customer via service did not return a valid Customer object with ID.');
    }

    console.log(`[QBO Action] Successfully created Customer ${createdCustomer.Id} for tenant ${tenant}, realm ${realmId}`);
    return createdCustomer; // Return the result from the service
    // Removed the try/catch block that called handleQboApiError
}

/**
 * Workflow Action: Updates an existing Customer in QuickBooks Online.
 * Handles tenant isolation, credential retrieval, API call, optimistic locking (SyncToken), and basic error handling.
 * Assumes locking/throttling is handled externally or within callQboApi.
 */
// Corrected signature: context is ActionExecutionContext
// Update signature to use WorkflowContext for consistency
async function updateQboCustomerAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboCustomer> {
  // Use ActionExecutionContext
  const validatedParams = params as UpdateQboCustomerParams; // Keep internal type assertion
  const { qboCustomerId, syncToken, customerData, realmId } = validatedParams;
  const { tenant } = context; // tenant is directly on ActionExecutionContext

  // Removed checks for context.actions and context.input as they are not used

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }
  if (!qboCustomerId || !syncToken) {
      throw new Error('Missing qboCustomerId or syncToken for update operation.');
  }

  console.log(`[QBO Action] Starting Update Customer ${qboCustomerId} for tenant ${tenant}, realm ${realmId}`);

  const qboClient = await getQboClient(tenant, realmId);

  // Removed Term lookup and human task creation logic - expected to be handled by workflow

  // The workflow is expected to provide customerData with SalesTermRef already mapped (if applicable)
  // and without the temporary PaymentTerms field.
  if ((customerData as any).PaymentTerms) {
      console.warn(`[QBO Action] customerData still contains PaymentTerms field for tenant ${tenant}, realm ${realmId}. This should be removed by the workflow.`);
      // Optionally remove it here as a safeguard.
      delete (customerData as any).PaymentTerms;
  }

  // Prepare the final payload for update using data provided by the workflow
  const updatePayload: Partial<QboCustomer> & { Id: string; SyncToken: string; sparse: boolean } = {
    ...customerData, // Use the mapped data from parameters
    Id: qboCustomerId,
    SyncToken: syncToken,
    sparse: true, // Use sparse update
  };

  // Call QBO API with the prepared payload
  const updatedCustomer = await qboClient.update<QboCustomer>('Customer', updatePayload);

    // Basic validation on the response from the service
    if (!updatedCustomer?.Id) {
        throw new Error('QBO Update Customer via service did not return a valid Customer object with ID.');
    }

    console.log(`[QBO Action] Successfully updated Customer ${updatedCustomer.Id} for tenant ${tenant}, realm ${realmId}`);
    return updatedCustomer; // Return the result from the service
    // Removed the try/catch block that called handleQboApiError
}

/**
 * Workflow Action: Queries for Customers in QuickBooks Online.
 * Useful for duplicate checking before creation.
 * Handles tenant isolation, credential retrieval, API call, and basic error handling.
 */
// Corrected signature: context is ActionExecutionContext
async function getQboCustomerAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboCustomer[]> {
    // Internal type assertion/validation (includes realmId now)
    const validatedParams = params as GetQboCustomerParams;
    const { query, fields, realmId } = validatedParams;
    const { tenant } = context;

    if (!realmId) {
        throw new Error('QBO Realm ID not found in action parameters.');
    }
    if (!tenant) {
        throw new Error('Tenant ID not found in action execution context.');
    }

    console.log(`[QBO Action] Starting Get Customer query for tenant ${tenant}, realm ${realmId}. Query: ${query}`); // Use validated query

    // Get the initialized QBO client for this tenant/realm
    const qboClient = await getQboClient(tenant, realmId);
  
    const selectFields = fields || '*'; // Use validated fields
    const fullQuery = `select ${selectFields} from Customer where ${query}`; // Use validated query
  
    // Use the QboClientService to execute the query
    // The service's query method returns the array of entities directly.
    const customers = await qboClient.query<QboCustomer>(fullQuery);
  
    console.log(`[QBO Action] Found ${customers.length} Customers matching query for tenant ${tenant}, realm ${realmId}`);
    return customers; // Return the result from the service
    // Removed the try/catch block that called handleQboApiError
    // Error handling (like returning empty array vs throwing) is now managed within the service or calling workflow
  }


// --- Action Registration ---

// Add realmId to parameter definitions as it's needed by the actions
const createQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...createQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Client ID) for the target tenant connection' },
];
const updateQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...updateQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Client ID) for the target tenant connection' },
];
const getQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...getQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Client ID) for the target tenant connection' },
];


registry.registerSimpleAction(
  'qbo:createCustomer',
  'Creates a new Customer in QuickBooks Online',
  createQboCustomerParamsDefWithRealm, // Use updated definitions
  createQboCustomerAction // Remove 'as any' - signature now matches ActionExecutionContext
);

registry.registerSimpleAction(
  'qbo:updateCustomer',
  'Updates an existing Customer in QuickBooks Online',
  updateQboCustomerParamsDefWithRealm, // Use updated definitions
  updateQboCustomerAction // Remove 'as any' - signature now matches ActionExecutionContext
);

registry.registerSimpleAction(
  'qbo:getCustomer',
  'Queries for Customers in QuickBooks Online',
  getQboCustomerParamsDefWithRealm, // Use updated definitions
  getQboCustomerAction // Keep as is, assuming it doesn't need the full WorkflowContext yet
);

// Export actions if needed elsewhere, though registry pattern often suffices
// export { createQboCustomerAction, updateQboCustomerAction, getQboCustomerAction };