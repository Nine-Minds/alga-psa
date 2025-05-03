// server/src/lib/actions/qbo/qboCustomerActions.ts

// Removed Zod import
import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry'; // Corrected path, added ActionParameterDefinition and ActionExecutionContext
// Removed WorkflowContext import as actions receive ActionExecutionContext
import { QboCustomer, QboTenantCredentials, QboQueryResponse, QboEntityResponse } from './types'; // Added QboEntityResponse
import { callQboApi, getTenantQboCredentials, handleQboApiError } from './qboUtils'; // Corrected path

const registry = getActionRegistry(); // Get the singleton instance

// --- Action Parameters Interfaces (kept for internal type safety) ---

interface CreateQboCustomerParams {
  customerData: Omit<QboCustomer, 'Id' | 'SyncToken' | 'MetaData'>;
  realmId: string; // Added realmId
}

interface UpdateQboCustomerParams {
  qboCustomerId: string;
  syncToken: string;
  customerData: Omit<QboCustomer, 'Id' | 'SyncToken' | 'MetaData'>;
  realmId: string; // Added realmId
}

interface GetQboCustomerParams {
  query: string;
  fields?: string;
  realmId: string; // Added realmId
}

// --- Action Parameter Definitions (for registration) ---

const createQboCustomerParamsDef: ActionParameterDefinition[] = [
  { name: 'customerData', type: 'object', required: true, description: 'QBO Customer object data (mapped from Alga)' },
];

const updateQboCustomerParamsDef: ActionParameterDefinition[] = [
  { name: 'qboCustomerId', type: 'string', required: true, description: 'The QBO ID of the customer to update' },
  { name: 'syncToken', type: 'string', required: true, description: 'The QBO SyncToken for optimistic locking' },
  { name: 'customerData', type: 'object', required: true, description: 'QBO Customer object data (mapped from Alga)' },
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
  // Internal type assertion/validation (includes realmId now)
  const validatedParams = params as CreateQboCustomerParams;
  const { customerData, realmId } = validatedParams;
  const { tenant } = context; // tenant is directly on ActionExecutionContext

  // Logger is not available on ActionExecutionContext, rely on registry logging or pass logger via params if needed

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    // Should not happen as tenant is required in ActionExecutionContext
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[QBO Action] Starting Create Customer for tenant ${tenant}, realm ${realmId}`); // Use console.log or pass logger

  try {
    const credentials = await getTenantQboCredentials(tenant, realmId); // Use 'tenant'
    const qboApiBaseUrl = 'https://quickbooks.api.intuit.com'; // Or sandbox URL based on environment

    // --- TODO: Lookup QBO Term ID ---
    // const algaPaymentTerms = customerData.PaymentTerms; // Assuming this exists on the mapped data
    // if (algaPaymentTerms) {
    //   // Placeholder: Call 'qbo:lookupTermId' action or implement direct lookup
    //   const termLookupResult = await lookupQboTermId({ alga_payment_terms: algaPaymentTerms, realmId }, context); // Needs proper call mechanism
    //   if (termLookupResult.qbo_term_id) {
    //      customerData.SalesTermRef = { value: termLookupResult.qbo_term_id };
    //   } else {
    //      console.warn(`[QBO Action] Missing QBO Term mapping for Alga terms: ${algaPaymentTerms}. Tenant: ${tenant}, Realm: ${realmId}`);
    //      // TODO: Create Human Task for missing mapping (Phase 2 / Section 5.3)
    //      // await createHumanTask({ taskType: 'QBO_MISSING_TERM_MAPPING', ... });
    //      throw new Error(`Missing QBO Term mapping for Alga terms: ${algaPaymentTerms}`); // Fail action for now
    //   }
    // }
    // --- End Lookup ---

    // QBO Create returns the full customer object keyed by "Customer"
    const response = await callQboApi<QboEntityResponse<QboCustomer>>({
      method: 'POST',
      url: `${qboApiBaseUrl}/v3/company/${realmId}/customer`,
      credentials,
      realmId,
      tenantId: tenant, // Pass tenant explicitly if needed by callQboApi internals
      data: customerData, // Use validated data
      // Removed context property from callQboApi args
    });

    // Extract customer from the response structure safely
    const createdCustomer = response?.Customer;
    // Type guard to ensure it's a QboCustomer object and not the 'time' string property
    if (typeof createdCustomer !== 'object' || createdCustomer === null || !('Id' in createdCustomer)) {
        throw new Error('QBO Create Customer response did not contain a valid Customer object with ID.');
    }

    console.log(`[QBO Action] Successfully created Customer ${createdCustomer.Id} for tenant ${tenant}, realm ${realmId}`);
    // Now createdCustomer is confirmed to be QboCustomer
    return createdCustomer as QboCustomer;

  } catch (error: any) {
    console.error(`[QBO Action] Error creating QBO Customer for tenant ${tenant}, realm ${realmId}: ${error.message}`, error);
    await handleQboApiError(error, tenant, realmId); // Pass tenant and realmId
    throw error; // Re-throw after handling/logging
  }
}

/**
 * Workflow Action: Updates an existing Customer in QuickBooks Online.
 * Handles tenant isolation, credential retrieval, API call, optimistic locking (SyncToken), and basic error handling.
 * Assumes locking/throttling is handled externally or within callQboApi.
 */
// Corrected signature: context is ActionExecutionContext
async function updateQboCustomerAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboCustomer> {
  // Internal type assertion/validation (includes realmId now)
  const validatedParams = params as UpdateQboCustomerParams;
  const { qboCustomerId, syncToken, customerData, realmId } = validatedParams;
  const { tenant } = context;

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[QBO Action] Starting Update Customer ${qboCustomerId} for tenant ${tenant}, realm ${realmId}`);

  try {
    const credentials = await getTenantQboCredentials(tenant, realmId); // Use 'tenant'
    const qboApiBaseUrl = 'https://quickbooks.api.intuit.com';

    // --- TODO: Lookup QBO Term ID ---
    // const algaPaymentTerms = customerData.PaymentTerms; // Assuming this exists on the mapped data
    // let qboTermRef: { value: string } | undefined = undefined;
    // if (algaPaymentTerms) {
    //   // Placeholder: Call 'qbo:lookupTermId' action or implement direct lookup
    //   const termLookupResult = await lookupQboTermId({ alga_payment_terms: algaPaymentTerms, realmId }, context); // Needs proper call mechanism
    //   if (termLookupResult.qbo_term_id) {
    //      qboTermRef = { value: termLookupResult.qbo_term_id };
    //   } else {
    //      console.warn(`[QBO Action] Missing QBO Term mapping for Alga terms: ${algaPaymentTerms}. Tenant: ${tenant}, Realm: ${realmId}`);
    //      // TODO: Create Human Task for missing mapping (Phase 2 / Section 5.3)
    //      throw new Error(`Missing QBO Term mapping for Alga terms: ${algaPaymentTerms}`); // Fail action for now
    //   }
    // }
    // --- End Lookup ---


    // QBO Update requires sparse update (only send changed fields) and the Id/SyncToken in the body
    const updatePayload: Partial<QboCustomer> & { Id: string; SyncToken: string; sparse: boolean } = {
      ...customerData, // Use validated data
      // SalesTermRef: qboTermRef, // Add looked-up term ref
      Id: qboCustomerId, // Use validated ID
      SyncToken: syncToken, // Use validated token
      sparse: true, // Indicate sparse update
    };

    // QBO Update returns the full customer object keyed by "Customer"
    const response = await callQboApi<QboEntityResponse<QboCustomer>>({
      method: 'POST', // Updates use POST
      url: `${qboApiBaseUrl}/v3/company/${realmId}/customer`, // Same endpoint as create
      credentials,
      realmId,
      tenantId: tenant, // Pass tenant explicitly
      data: updatePayload,
      // Removed context property from callQboApi args
    });

    // Extract customer from the response structure safely
    const updatedCustomer = response?.Customer;
    // Type guard to ensure it's a QboCustomer object
    if (typeof updatedCustomer !== 'object' || updatedCustomer === null || !('Id' in updatedCustomer)) {
        throw new Error('QBO Update Customer response did not contain a valid Customer object with ID.');
    }

    console.log(`[QBO Action] Successfully updated Customer ${updatedCustomer.Id} for tenant ${tenant}, realm ${realmId}`);
    // Now updatedCustomer is confirmed to be QboCustomer
    return updatedCustomer as QboCustomer;

  } catch (error: any) {
    console.error(`[QBO Action] Error updating QBO Customer ${qboCustomerId} for tenant ${tenant}, realm ${realmId}: ${error.message}`, error); // Use validated ID in log
    await handleQboApiError(error, tenant, realmId); // Pass tenant and realmId
    throw error;
  }
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

    try {
        const credentials = await getTenantQboCredentials(tenant, realmId); // Use 'tenant'
        const qboApiBaseUrl = 'https://quickbooks.api.intuit.com';
        const selectFields = fields || '*'; // Use validated fields
        const encodedQuery = encodeURIComponent(`select ${selectFields} from Customer where ${query}`); // Use validated query

        const response = await callQboApi<QboQueryResponse<QboCustomer>>({
            method: 'GET',
            url: `${qboApiBaseUrl}/v3/company/${realmId}/query?query=${encodedQuery}`,
            credentials,
            realmId,
            tenantId: tenant, // Pass tenant explicitly
            // Removed context property from callQboApi args
        });

        // Extract customers from the QueryResponse structure safely
        const customerData = response?.QueryResponse?.Customer;
        // Type guard to ensure it's an array
        const customers = Array.isArray(customerData) ? customerData : [];

        console.log(`[QBO Action] Found ${customers.length} Customers matching query for tenant ${tenant}, realm ${realmId}`);
        return customers;

    } catch (error: any) {
        console.error(`[QBO Action] Error querying QBO Customers for tenant ${tenant}, realm ${realmId}: ${error.message}`, error);
        await handleQboApiError(error, tenant, realmId); // Pass tenant and realmId
        // Depending on use case, might return empty array instead of throwing
        return [];
        // throw error;
    }
}


// --- Action Registration ---

// Add realmId to parameter definitions as it's needed by the actions
const createQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...createQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Company ID) for the target tenant connection' },
];
const updateQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...updateQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Company ID) for the target tenant connection' },
];
const getQboCustomerParamsDefWithRealm: ActionParameterDefinition[] = [
  ...getQboCustomerParamsDef,
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Company ID) for the target tenant connection' },
];


registry.registerSimpleAction(
  'qbo:createCustomer',
  'Creates a new Customer in QuickBooks Online',
  createQboCustomerParamsDefWithRealm, // Use updated definitions
  createQboCustomerAction
);

registry.registerSimpleAction(
  'qbo:updateCustomer',
  'Updates an existing Customer in QuickBooks Online',
  updateQboCustomerParamsDefWithRealm, // Use updated definitions
  updateQboCustomerAction
);

registry.registerSimpleAction(
  'qbo:getCustomer',
  'Queries for Customers in QuickBooks Online',
  getQboCustomerParamsDefWithRealm, // Use updated definitions
  getQboCustomerAction
);

// Export actions if needed elsewhere, though registry pattern often suffices
// export { createQboCustomerAction, updateQboCustomerAction, getQboCustomerAction };