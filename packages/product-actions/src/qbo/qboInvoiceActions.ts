// server/src/lib/actions/qbo/qboInvoiceActions.ts

import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry';
import { QboInvoice, QboSalesItemLineDetail } from './types'; // Removed QboEntityResponse as it's handled by the service
import { getQboClient } from '@server/lib/qbo/qboClientService'; // Corrected import path
// Removed unused imports for lookupExternalEntityIdAction and createHumanTask as logic moved to workflow

const registry = getActionRegistry();

// --- Action Parameters Interfaces ---

interface CreateQboInvoiceParams {
  invoiceData: Omit<QboInvoice, 'Id' | 'SyncToken' | 'MetaData' | 'TotalAmt'>; // Data mapped from Alga Invoice
  realmId: string;
}

interface UpdateQboInvoiceParams {
  qboInvoiceId: string;
  syncToken: string;
  invoiceData: Omit<QboInvoice, 'Id' | 'SyncToken' | 'MetaData' | 'TotalAmt'>; // Data mapped from Alga Invoice
  realmId: string;
}

// --- Action Parameter Definitions ---

const createQboInvoiceParamsDef: ActionParameterDefinition[] = [
  { name: 'invoiceData', type: 'object', required: true, description: 'QBO Invoice object data (mapped from Alga)' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Client ID) for the target tenant connection' },
];

const updateQboInvoiceParamsDef: ActionParameterDefinition[] = [
  { name: 'qboInvoiceId', type: 'string', required: true, description: 'The QBO ID of the invoice to update' },
  { name: 'syncToken', type: 'string', required: true, description: 'The QBO SyncToken for optimistic locking' },
  { name: 'invoiceData', type: 'object', required: true, description: 'QBO Invoice object data (mapped from Alga)' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Client ID) for the target tenant connection' },
];

// --- Action Implementations ---

/**
 * Workflow Action: Creates a new Invoice in QuickBooks Online.
 */
async function createQboInvoiceAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboInvoice> {
  const validatedParams = params as CreateQboInvoiceParams;
  const { invoiceData, realmId } = validatedParams;
  const { tenant } = context;

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[QBO Action] Starting Create Invoice for tenant ${tenant}, realm ${realmId}`);

  // Get the initialized QBO client for this tenant/realm
  const qboClient = await getQboClient(tenant, realmId);

  // --- Data Validation (Optional - can be done in workflow) ---
  // Basic check: Ensure invoiceData and Line items exist
  if (!invoiceData || !Array.isArray(invoiceData.Line)) {
      throw new Error('Invalid invoiceData structure provided to createQboInvoiceAction.');
  }
  // NOTE: Detailed line item validation (e.g., checking for ItemRef.value)
  // is now expected to be handled by the calling workflow *before* this action.

  // --- QBO API Call ---
  // Use the QboClientService to create the invoice
  // The service handles the actual API call, headers, token, etc.
  // The invoiceData is assumed to be fully mapped with correct QBO IDs by the workflow.
  const createdInvoice = await qboClient.create<QboInvoice>('Invoice', invoiceData);

    // Basic validation on the response from the service
    if (!createdInvoice?.Id) {
        throw new Error('QBO Create Invoice via service did not return a valid Invoice object with ID.');
    }

    console.log(`[QBO Action] Successfully created Invoice ${createdInvoice.Id} for tenant ${tenant}, realm ${realmId}`);
    return createdInvoice; // Return the result from the service
    // Removed the try/catch block that called handleQboApiError
}

/**
 * Workflow Action: Updates an existing Invoice in QuickBooks Online.
 */
async function updateQboInvoiceAction(params: Record<string, any>, context: ActionExecutionContext): Promise<QboInvoice> {
  const validatedParams = params as UpdateQboInvoiceParams;
  const { qboInvoiceId, syncToken, invoiceData, realmId } = validatedParams;
  const { tenant } = context;

  if (!realmId) {
    throw new Error('QBO Realm ID not found in action parameters.');
  }
  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }

  console.log(`[QBO Action] Starting Update Invoice ${qboInvoiceId} for tenant ${tenant}, realm ${realmId}`);

  // Get the initialized QBO client for this tenant/realm
  const qboClient = await getQboClient(tenant, realmId);

  // --- Data Validation (Optional - can be done in workflow) ---
  if (!invoiceData || !Array.isArray(invoiceData.Line)) {
      throw new Error('Invalid invoiceData structure provided to updateQboInvoiceAction.');
  }
  // NOTE: Detailed line item validation (e.g., checking for ItemRef.value)
  // is now expected to be handled by the calling workflow *before* this action.

  // --- Prepare Update Payload ---
  // The invoiceData is assumed to be fully mapped with correct QBO IDs by the workflow.
  const updatePayload: Partial<QboInvoice> & { Id: string; SyncToken: string; sparse: boolean } = {
    ...invoiceData, // Use the mapped data directly from parameters
    Id: qboInvoiceId,
    SyncToken: syncToken,
    sparse: true, // Use sparse update
  };

    // Use the QboClientService to update the invoice
    // The service handles the actual API call, headers, token, etc.
    const updatedInvoice = await qboClient.update<QboInvoice>('Invoice', updatePayload);

     // Basic validation on the response from the service
    if (!updatedInvoice?.Id) {
        throw new Error('QBO Update Invoice via service did not return a valid Invoice object with ID.');
    }

    console.log(`[QBO Action] Successfully updated Invoice ${updatedInvoice.Id} for tenant ${tenant}, realm ${realmId}`);
    return updatedInvoice; // Return the result from the service
    // Removed the try/catch block that called handleQboApiError
}

// --- Action Registration ---

registry.registerSimpleAction(
  'qbo:createInvoice',
  'Creates a new Invoice in QuickBooks Online',
  createQboInvoiceParamsDef,
  createQboInvoiceAction
);

registry.registerSimpleAction(
  'qbo:updateInvoice',
  'Updates an existing Invoice in QuickBooks Online',
  updateQboInvoiceParamsDef,
  updateQboInvoiceAction
);