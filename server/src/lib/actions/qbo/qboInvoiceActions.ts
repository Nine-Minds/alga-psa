// server/src/lib/actions/qbo/qboInvoiceActions.ts

import { getActionRegistry, ActionParameterDefinition, ActionExecutionContext } from '@shared/workflow/core/actionRegistry';
import { QboInvoice, QboSalesItemLineDetail } from './types'; // Removed QboEntityResponse as it's handled by the service
import { getQboClient } from '../../qbo/qboClientService'; // Corrected import path

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
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Company ID) for the target tenant connection' },
];

const updateQboInvoiceParamsDef: ActionParameterDefinition[] = [
  { name: 'qboInvoiceId', type: 'string', required: true, description: 'The QBO ID of the invoice to update' },
  { name: 'syncToken', type: 'string', required: true, description: 'The QBO SyncToken for optimistic locking' },
  { name: 'invoiceData', type: 'object', required: true, description: 'QBO Invoice object data (mapped from Alga)' },
  { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID (Company ID) for the target tenant connection' },
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

  // --- Lookup QBO Item IDs and Tax Code IDs for Lines ---
  // NOTE: This placeholder lookup logic remains for now.
  // In a real implementation, these lookups might also use the qboClient.query method.
  const processedLines = [];
    for (const line of invoiceData.Line) {
        let finalSalesItemDetail: QboSalesItemLineDetail | undefined = undefined;

        if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail) {
            let currentDetail = { ...line.SalesItemLineDetail }; // Start with existing detail
            let qboItemId: string | null = null;
            let qboTaxCodeId: string | null = null;

            // --- Lookup Item ID ---
            if (currentDetail.ItemRef?.value) { // Check if Alga ID is present
                const algaServiceId = currentDetail.ItemRef.value;
                console.warn(`[QBO Action] Placeholder: Looking up Item ID for Alga Service ID ${algaServiceId}`);
                // const itemLookupResult = await lookupQboItemId({ alga_service_id: algaServiceId, realmId }, context);
                qboItemId = `qbo-item-for-${algaServiceId}`; // Placeholder result
                if (!qboItemId) {
                    console.warn(`[QBO Action] Missing QBO Item mapping for Alga Service ID: ${algaServiceId}. Tenant: ${tenant}, Realm: ${realmId}`);
                    // TODO: Create Human Task for missing mapping
                    throw new Error(`Missing QBO Item mapping for Alga Service ID: ${algaServiceId}`);
                }
            } else {
                // ItemRef is required for SalesItemLineDetail
                throw new Error(`Missing initial ItemRef value for SalesItemLineDetail on line: ${line.Description || 'N/A'}`);
            }

            // --- Lookup Tax Code ID (only proceed if Item lookup succeeded) ---
            if (currentDetail.TaxCodeRef?.value) { // Check if Alga Tax ID is present
                 const algaTaxId = currentDetail.TaxCodeRef.value;
                 console.warn(`[QBO Action] Placeholder: Looking up Tax Code ID for Alga Tax ID/Region ${algaTaxId}`);
                 // const taxLookupResult = await lookupQboTaxCodeId({ alga_tax_region: algaTaxId, realmId }, context);
                 qboTaxCodeId = `qbo-taxcode-for-${algaTaxId}`; // Placeholder result
                 if (!qboTaxCodeId) {
                     console.warn(`[QBO Action] Missing QBO Tax Code mapping for Alga Tax ID/Region: ${algaTaxId}. Tenant: ${tenant}, Realm: ${realmId}`);
                     // TODO: Create Human Task for missing mapping
                     throw new Error(`Missing QBO Tax Code mapping for Alga Tax ID/Region: ${algaTaxId}`);
                 }
            }
            // else: TaxCodeRef might be optional, no error if missing initially

            // --- Construct final SalesItemLineDetail ---
            // Ensure required ItemRef is present
            finalSalesItemDetail = {
                ...currentDetail, // Spread existing optional properties like Qty, UnitPrice etc.
                ItemRef: { value: qboItemId }, // Assign looked-up ID (guaranteed non-null here)
                TaxCodeRef: qboTaxCodeId ? { value: qboTaxCodeId } : undefined, // Assign looked-up ID or undefined
            };

        } else if (line.DetailType !== 'SalesItemLineDetail') {
            // Handle other line types (Discount, DescriptionOnly etc.) - no lookups needed
        } else {
            // If it was supposed to be SalesItemLineDetail but was missing, throw error
            throw new Error(`Missing SalesItemLineDetail object for line item: ${line.Description || 'N/A'}`);
        }

        // Construct the final processed line, replacing SalesItemLineDetail if applicable
        processedLines.push({
            ...line,
            SalesItemLineDetail: finalSalesItemDetail, // Assign the processed detail (or undefined)
        });
    }
    const finalInvoiceData = { ...invoiceData, Line: processedLines };
    // --- End Lookups ---


    // Use the QboClientService to create the invoice
    // The service handles the actual API call, headers, token, etc.
    // The service's create method returns the created entity directly.
    const createdInvoice = await qboClient.create<QboInvoice>('Invoice', finalInvoiceData);

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

  // --- Lookup QBO Item IDs and Tax Code IDs for Lines (similar to create) ---
  // NOTE: This placeholder lookup logic remains for now.
  const processedLinesUpdate = [];
    for (const line of invoiceData.Line) {
        let finalSalesItemDetailUpdate: QboSalesItemLineDetail | undefined = undefined;

        if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail) {
            let currentDetail = { ...line.SalesItemLineDetail };
            let qboItemId: string | null = null;
            let qboTaxCodeId: string | null = null;

            // Lookup Item ID
            if (currentDetail.ItemRef?.value) {
                const algaServiceId = currentDetail.ItemRef.value;
                console.warn(`[QBO Action] Placeholder: Looking up Item ID for Alga Service ID ${algaServiceId}`);
                qboItemId = `qbo-item-for-${algaServiceId}`; // Placeholder
                if (!qboItemId) {
                    throw new Error(`Missing QBO Item mapping for Alga Service ID: ${algaServiceId}`);
                }
            } else {
                 throw new Error(`Missing initial ItemRef value for SalesItemLineDetail on line: ${line.Description || 'N/A'}`);
            }

            // Lookup Tax Code ID
            if (currentDetail.TaxCodeRef?.value) {
                 const algaTaxId = currentDetail.TaxCodeRef.value;
                 console.warn(`[QBO Action] Placeholder: Looking up Tax Code ID for Alga Tax ID/Region ${algaTaxId}`);
                 qboTaxCodeId = `qbo-taxcode-for-${algaTaxId}`; // Placeholder
                 if (!qboTaxCodeId) {
                     throw new Error(`Missing QBO Tax Code mapping for Alga Tax ID/Region: ${algaTaxId}`);
                 }
            }

            // Construct final SalesItemLineDetail
            finalSalesItemDetailUpdate = {
                ...currentDetail, // Spread existing optional properties
                ItemRef: { value: qboItemId }, // Assign looked-up ID (guaranteed non-null)
                TaxCodeRef: qboTaxCodeId ? { value: qboTaxCodeId } : undefined, // Assign looked-up ID or undefined
            };
        } else if (line.DetailType !== 'SalesItemLineDetail') {
            // Handle other line types
        } else {
             throw new Error(`Missing SalesItemLineDetail object for line item: ${line.Description || 'N/A'}`);
        }

        processedLinesUpdate.push({
            ...line,
            SalesItemLineDetail: finalSalesItemDetailUpdate, // Assign the processed detail
        });
    }
    const finalInvoiceDataUpdate = { ...invoiceData, Line: processedLinesUpdate };
    // --- End Lookups ---

    const updatePayload: Partial<QboInvoice> & { Id: string; SyncToken: string; sparse: boolean } = {
      ...finalInvoiceDataUpdate, // Use data with looked-up IDs
      Id: qboInvoiceId,
      SyncToken: syncToken,
      sparse: true,
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