// server/src/lib/actions/qbo/qboCustomerActions.ts

// Removed Zod import
import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry'; // Corrected path, added ActionParameterDefinition and ActionExecutionContext
// Removed WorkflowContext import as actions receive ActionExecutionContext
import { QboCustomer } from './types'; // Removed QboTenantCredentials, QboQueryResponse, QboEntityResponse
import { getQboClient } from '../../qbo/qboClientService'; // Corrected import path

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

  // Get the initialized QBO client for this tenant/realm
  const qboClient = await getQboClient(tenant, realmId);

  // --- TODO: Lookup QBO Term ID ---
  // NOTE: This placeholder lookup logic remains for now.
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

    // Use the QboClientService to create the customer
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

  // Get the initialized QBO client for this tenant/realm
  const qboClient = await getQboClient(tenant, realmId);

  // --- TODO: Lookup QBO Term ID ---
  // NOTE: This placeholder lookup logic remains for now.
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

    // Use the QboClientService to update the customer
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