import { WorkflowContext } from '@shared/workflow'; // Assuming path
// TODO: Confirm actual path for WorkflowContext type

// Define placeholder types for data structures until actual types are available
type AlgaInvoice = { id: string; companyId: string; qbo_invoice_id?: string; qbo_sync_token?: string; /* ... other fields */ };
type AlgaInvoiceItem = { id: string; invoiceId: string; productId?: string; amount?: number; /* ... other fields */ }; // Added amount
type AlgaCompany = { id: string; qbo_customer_id?: string; qbo_term_id?: string; /* ... other fields */ };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; /* ... other QBO fields */ };
type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; /* ... other potential payload fields */ }; // Added realmId/tenantId possibility
type QboApiError = { message: string; details?: any; statusCode?: number };
type HumanTaskDetails = { message: string; algaInvoiceId: string; tenantId: string; realmId: string; [key: string]: any; }; // Type for task details

// Placeholder action types (replace with actual imports/types)
interface WorkflowActions {
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>;
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<AlgaInvoiceItem[]>;
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>;
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string }) => Promise<string | null>;
    // lookupQboTaxCodeId: (args: { algaTaxRateId: string; tenantId: string; realmId: string }) => Promise<string | null>;
    // lookupQboTermId: (args: { algaTermId: string; tenantId: string; realmId: string }) => Promise<string | null>;
    createHumanTask: (args: { taskType: string; title: string; details: HumanTaskDetails; assignedUserId?: string | null; tenantId: string; }) => Promise<void>;
    triggerWorkflow: (args: { name: string; input: any; tenantId: string; }) => Promise<void>;
    updateQboInvoice: (args: { qboInvoiceData: QboInvoiceData; qboInvoiceId: string; qboSyncToken: string; tenantId: string; realmId: string }) => Promise<{ Id: string; SyncToken: string }>;
    createQboInvoice: (args: { qboInvoiceData: QboInvoiceData; tenantId: string; realmId: string }) => Promise<{ Id: string; SyncToken: string }>;
    updateInvoiceQboDetails: (args: { invoiceId: string; qboInvoiceId?: string | null; qboSyncToken?: string | null; lastSyncStatus: 'SUCCESS' | 'FAILED' | 'PENDING'; lastSyncTimestamp: string; lastSyncError?: any; tenantId: string }) => Promise<void>;
    // Add other necessary actions
}


/**
 * Workflow to synchronize an Alga PSA Invoice with QuickBooks Online.
 * Triggered by INVOICE_CREATED or INVOICE_UPDATED events.
 */
export async function qboInvoiceSyncWorkflow(context: WorkflowContext): Promise<void> {
    // Use type assertion for actions if necessary, or ensure WorkflowContext provides typed actions
    // Destructure properties from the updated WorkflowContext
    const { actions, data, events, logger, input, setState, getCurrentState, tenant, executionId } = context;
    // Assert actions type separately if needed
    const typedActions = actions as WorkflowActions;
    const currentState = getCurrentState();

    logger.info(`QBO Invoice Sync workflow starting/resuming. Instance ID: ${executionId}. Current state: ${currentState ?? 'INITIAL'}`);

    // --- 1. Initialization & Trigger Context ---
    // tenant and executionId are now destructured directly from context
    const triggerEvent = input?.triggerEvent;
    const triggerPayload = triggerEvent?.payload as TriggerEventPayload | undefined;
    const realmId = triggerPayload?.realmId; // Assuming it's in the payload, adjust if needed
    const triggerEventName = triggerEvent?.name; // e.g., 'INVOICE_CREATED', 'INVOICE_UPDATED'
    const algaInvoiceId = triggerPayload?.invoiceId;

    // Use tenant from context
    if (!tenant || !realmId || !algaInvoiceId) {
        logger.error('Missing critical context: tenant, realmId, or invoiceId in trigger payload.', { tenant, realmId, payload: triggerPayload, executionId });
        setState('FAILED_INITIALIZATION');
        // Potentially create a human task here if this scenario needs manual intervention
        return;
    }

    // Set initial state only if it's the very first run
    if (currentState === null) {
        setState('INITIAL');
    }

    logger.info('Workflow context initialized.', { tenant, realmId, triggerEventName, algaInvoiceId, executionId }); // This line was already correct in the provided file content

    // --- Resume Logic ---
    if (currentState === 'WAITING_FOR_CUSTOMER_SYNC') {
        logger.info('Resuming workflow after customer sync.', { executionId }); // This line was already correct
        // Re-fetch potentially updated company data? Or assume the trigger mechanism provides it?
        // For now, proceed directly to mapping, assuming the necessary data is available or re-fetched if needed.
        // TODO: Refine the Customer Sync dependency mechanism (how the workflow resumes/re-triggers and ensures data consistency).
        // It might be safer to re-fetch the company data here upon resume.
        try {
             // Use tenant from context
             const potentiallyUpdatedCompany: AlgaCompany = await typedActions.getCompany({ id: data.get<AlgaInvoice>('algaInvoice')?.companyId!, tenantId: tenant }); // Use tenant variable
             if (potentiallyUpdatedCompany) {
                 data.set('algaCompany', potentiallyUpdatedCompany);
                 logger.info('Re-fetched company data upon resuming from customer sync wait.', { companyId: potentiallyUpdatedCompany.id, hasQboId: !!potentiallyUpdatedCompany.qbo_customer_id, executionId }); // This line was already correct
             } else {
                 throw new Error('Failed to re-fetch company data after customer sync wait.');
             }
        } catch (fetchError: any) {
             logger.error('Error re-fetching company data after customer sync wait.', { error: fetchError?.message, executionId }); // This line was already correct
             setState('DATA_FETCH_ERROR'); // Or a more specific state
             // Create human task?
             return;
        }

    } else if (currentState !== 'INITIAL' && currentState !== null) {
        logger.info(`Resuming workflow from state: ${currentState}`, { executionId }); // This line was already correct
        // Potentially add logic here if specific actions are needed when resuming from other states
    }


    try {
        // --- 2. Data Fetching ---
        // Fetch only if data isn't already loaded (e.g., on initial run or if resume logic doesn't guarantee it)
        if (!data.get('algaInvoice') || !data.get('algaInvoiceItems') || !data.get('algaCompany')) {
            setState('FETCHING_DATA');
            logger.info('Fetching required data from Alga PSA.', { executionId }); // This line was already correct

            // TODO: Confirm action names and parameters for fetching data
            // Use tenant from context
            const invoice: AlgaInvoice = await typedActions.getInvoice({ id: algaInvoiceId, tenantId: tenant }); // Use tenant variable
            // Ensure companyId is available before fetching company/items
            if (!invoice?.companyId) {
                 logger.error('Fetched invoice is missing companyId.', { algaInvoiceId, tenant, executionId }); // This line was already correct
                 setState('DATA_FETCH_ERROR');
                 return;
            }
            const invoiceItems: AlgaInvoiceItem[] = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant }); // Use tenant variable
            const company: AlgaCompany = await typedActions.getCompany({ id: invoice.companyId, tenantId: tenant }); // Use tenant variable

            if (!invoice || !invoiceItems || !company) {
                logger.error('Failed to fetch required Alga data.', { algaInvoiceId, companyId: invoice?.companyId, executionId }); // This line was already correct
                setState('DATA_FETCH_ERROR');
                // TODO: Consider creating a human task for data fetch errors
                return;
            }

            data.set('algaInvoice', invoice);
            data.set('algaInvoiceItems', invoiceItems);
            data.set('algaCompany', company);
            logger.info('Successfully fetched Alga data.', { executionId }); // This line was already correct
        }

        // Retrieve data from context after ensuring it's fetched/loaded
        const algaInvoice = data.get<AlgaInvoice>('algaInvoice');
        const algaInvoiceItems = data.get<AlgaInvoiceItem[]>('algaInvoiceItems');
        const algaCompany = data.get<AlgaCompany>('algaCompany');

        // Double-check data presence after fetch/resume logic
        if (!algaInvoice || !algaInvoiceItems || !algaCompany) {
             logger.error('Required data not found in workflow context after fetch/resume.', { algaInvoiceId, executionId }); // This line was already correct
             setState('INTERNAL_ERROR'); // Indicate an unexpected state issue
             return;
        }

        // --- 3. Customer Sync Dependency Check ---
        // Check if we are in a state where this check is needed
        const needsCustomerCheck = ['INITIAL', 'FETCHING_DATA', 'WAITING_FOR_CUSTOMER_SYNC'].includes(getCurrentState() ?? 'INITIAL');

        if (needsCustomerCheck) {
            setState('CHECKING_CUSTOMER_MAPPING');
            logger.info('Checking for QBO Customer mapping.', { companyId: algaCompany.id, executionId }); // This line was already correct

            if (!algaCompany.qbo_customer_id) {
                logger.warn('QBO Customer ID missing for Company. Triggering Customer Sync.', { companyId: algaCompany.id, executionId }); // This line was already correct
                setState('WAITING_FOR_CUSTOMER_SYNC');

                // TODO: Confirm action name and parameters for triggering workflow
                // Ensure the triggered workflow knows how to signal back or update the necessary state
                await typedActions.triggerWorkflow({
                    name: 'qboCustomerSyncWorkflow', // Standardized name
                    input: {
                        triggerEvent: { // Mimic structure if needed by target workflow
                            name: 'CUSTOMER_SYNC_REQUESTED', // Event name indicating the trigger reason
                            payload: {
                                companyId: algaCompany.id,
                                tenantId: tenant, // Use tenant variable
                                realmId: realmId,
                                originatingWorkflowInstanceId: executionId // Use executionId variable
                            }
                        }
                    },
                    tenantId: tenant // Use tenant variable
                });

                logger.info('Customer Sync workflow triggered. Pausing Invoice Sync.', { executionId }); // This line was already correct
                // Workflow pauses here implicitly by returning. Platform handles state persistence.
                return;
            } else {
                logger.info('QBO Customer mapping found.', { qboCustomerId: algaCompany.qbo_customer_id, executionId }); // This line was already correct
            }
        }


        // --- 4. Data Mapping ---
        // Proceed if customer mapping exists or we resumed past that check
        setState('MAPPING_DATA');
        logger.info('Mapping Alga Invoice data to QBO format.', { executionId }); // This line was already correct

        const qboInvoiceLines: any[] = [];
        let mappingErrorOccurred = false; // Flag to prevent multiple human tasks for one run

        for (const item of algaInvoiceItems) {
            // TODO: Confirm lookup action names and parameters
            let qboItemId: string | null = null;
            if (item.productId) {
                 // Use tenant from context
                 qboItemId = await typedActions.lookupQboItemId({ algaProductId: item.productId, tenantId: tenant, realmId }); // Use tenant variable
                 if (!qboItemId) {
                    logger.error('Failed to map Alga Product to QBO Item.', { algaProductId: item.productId, tenant, realmId, executionId }); // This line was already correct
                    mappingErrorOccurred = true;
                    // TODO: Define JSON schema for human task form
                    await typedActions.createHumanTask({
                        taskType: 'qbo_mapping_error',
                        title: `QBO Item Mapping Required for Product ID: ${item.productId}`,
                        details: {
                            message: `Cannot sync invoice ${algaInvoice.id} because Alga Product ID ${item.productId} is not mapped to a QBO Item for Realm ID ${realmId}. Please map the product in Alga PSA settings.`,
                            algaInvoiceId: algaInvoice.id,
                            algaProductId: item.productId,
                            tenantId: tenant, // Use tenant variable
                            realmId: realmId,
                            workflowInstanceId: executionId, // Use executionId variable
                        },
                        assignedUserId: null, // Or assign based on rules
                        tenantId: tenant, // Use tenant variable
                    });
                    // Continue checking other items to potentially create multiple tasks if needed, or break/return here?
                    // For now, let's break after the first mapping error to avoid spamming tasks for one invoice.
                    break;
                 }
            } else {
                // Handle description-only lines if applicable, might need a default item?
                logger.warn("Invoice line item does not have an associated product ID.", { lineItemId: item.id, executionId }); // This line was already correct
                mappingErrorOccurred = true;
                // Decide how to handle this - skip? use a default QBO item? error?
                // Creating a human task seems appropriate.
                 await typedActions.createHumanTask({
                     taskType: 'qbo_mapping_error',
                     title: `Invoice Line Item Missing Product Association`,
                     details: {
                         message: `Cannot sync invoice ${algaInvoice.id} because line item ${item.id} does not have an associated Alga Product. Please associate a product or handle description-only lines.`,
                         algaInvoiceId: algaInvoice.id,
                         algaLineItemId: item.id,
                         tenantId: tenant, // Use tenant variable
                         realmId: realmId,
                         workflowInstanceId: executionId, // Use executionId variable
                     },
                     assignedUserId: null,
                     tenantId: tenant, // Use tenant variable
                 });
                 break; // Break after first error
            }


            // TODO: Confirm lookup action name and parameters for TaxCode
            // const qboTaxCodeId = await typedActions.lookupQboTaxCodeId({ algaTaxRateId: item.taxRateId, tenantId: tenant, realmId }); // Use tenant variable
            // if (!qboTaxCodeId) {
            //     logger.error('Failed to map Alga Tax Rate to QBO Tax Code.', { algaTaxRateId: item.taxRateId, executionId }); // This line was already correct
            //     mappingErrorOccurred = true;
            //     // TODO: Create human task for tax code mapping
            //     break;
            // }

            // Simplified mapping - expand based on QBO API requirements and Section 3 of Plan
            qboInvoiceLines.push({
                Amount: item.amount ?? 0, // Use amount, ensure it exists
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: {
                    ItemRef: { value: qboItemId },
                    // TaxCodeRef: { value: qboTaxCodeId }, // Add once lookup is implemented
                    // Qty: item.quantity,
                    // UnitPrice: item.unitPrice,
                },
                // Description: item.description,
            });
        }

        // If any mapping error occurred, set state and return
        if (mappingErrorOccurred) {
            setState('MAPPING_ERROR');
            logger.warn('Mapping errors encountered. Halting sync for this invoice.', { executionId }); // This line was already correct
             // Update Alga status to reflect mapping issue?
             // Use tenant from context
             await typedActions.updateInvoiceQboDetails({
                 invoiceId: algaInvoice.id,
                 lastSyncStatus: 'FAILED',
                 lastSyncTimestamp: new Date().toISOString(),
                 lastSyncError: { message: "Mapping error encountered. See Human Tasks for details." },
                 tenantId: tenant // Use tenant variable
             });
            return;
        }

        // TODO: Confirm lookup action name and parameters for Term (likely from Company)
        // const qboTermId = await typedActions.lookupQboTermId({ algaTermId: algaCompany.termId, tenantId: tenant, realmId }); // Use tenant variable
         const qboTermId = algaCompany.qbo_term_id; // Assuming direct mapping stored on company for now
         if (!qboTermId) {
             logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { companyId: algaCompany.id, executionId }); // This line was already correct
             // Decide if this is critical - maybe QBO uses a default?
         }


        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: algaCompany.qbo_customer_id! }, // Assert non-null as we checked earlier
            // --- Add other fields based on Section 3 of Plan ---
            // DocNumber: algaInvoice.invoiceNumber,
            // TxnDate: algaInvoice.issueDate, // Format as YYYY-MM-DD
            // DueDate: algaInvoice.dueDate, // Format as YYYY-MM-DD
            // SalesTermRef: qboTermId ? { value: qboTermId } : undefined,
            // BillEmail: { Address: algaCompany.email }, // Map relevant fields
            // BillAddr: { ... }, // Map address fields from Alga Company/Invoice
            // ShipAddr: { ... },
            // CustomField: [ ... ], // Map custom fields if needed
            // ApplyTaxAfterDiscount: ...,
            // PrintStatus: ...,
            // EmailStatus: ...,
            // TxnTaxDetail: { ... } // If handling tax explicitly
        };
        data.set('qboInvoiceData', qboInvoiceData); // Store mapped data in context
        logger.info('Successfully mapped data to QBO format.', { lineItemCount: qboInvoiceLines.length, executionId }); // This line was already correct


        // --- 5. Determine Operation & Execute QBO Action ---
        const existingQboInvoiceId = algaInvoice.qbo_invoice_id;
        const qboSyncToken = algaInvoice.qbo_sync_token; // Needed for updates

        try {
            let qboResult: { Id: string; SyncToken: string };

            if (existingQboInvoiceId && qboSyncToken) {
                // --- Update Existing QBO Invoice ---
                setState('CALLING_QBO_UPDATE');
                logger.info('Calling QBO API to update existing invoice.', { qboInvoiceId: existingQboInvoiceId, executionId }); // This line was already correct
                // TODO: Confirm action name and parameters for update
                // Use tenant from context
                qboResult = await typedActions.updateQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    qboInvoiceId: existingQboInvoiceId,
                    qboSyncToken: qboSyncToken,
                    tenantId: tenant, // Use tenant variable
                    realmId: realmId
                });
                logger.info('Successfully updated invoice in QBO.', { qboInvoiceId: qboResult.Id, executionId }); // This line was already correct

            } else {
                // --- Create New QBO Invoice ---
                setState('CALLING_QBO_CREATE');
                logger.info('Calling QBO API to create new invoice.', { executionId }); // This line was already correct
                 // TODO: Confirm action name and parameters for create
                 // Use tenant from context
                qboResult = await typedActions.createQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    tenantId: tenant, // Use tenant variable
                    realmId: realmId
                });
                logger.info('Successfully created invoice in QBO.', { qboInvoiceId: qboResult.Id, executionId }); // This line was already correct
            }

            // --- 6. Update Alga PSA Record ---
            setState('UPDATING_ALGA');
            logger.info('Updating Alga PSA invoice with QBO details.', { algaInvoiceId: algaInvoice.id, qboInvoiceId: qboResult.Id, executionId }); // This line was already correct
            // TODO: Confirm action name and parameters for updating Alga
            // Use tenant from context
            await typedActions.updateInvoiceQboDetails({
                invoiceId: algaInvoice.id,
                qboInvoiceId: qboResult.Id,
                qboSyncToken: qboResult.SyncToken,
                lastSyncStatus: 'SUCCESS',
                lastSyncTimestamp: new Date().toISOString(),
                lastSyncError: null, // Clear previous errors on success
                tenantId: tenant // Use tenant variable
            });

            setState('SYNC_COMPLETE');
            logger.info('QBO Invoice sync successful.', { algaInvoiceId: algaInvoice.id, qboInvoiceId: qboResult.Id, executionId }); // This line was already correct

        } catch (error: any) {
            const qboError = error?.response?.data?.Fault?.Error?.[0]; // Structure from QBO v3 API errors
            const errorMessage = qboError?.Message ?? error?.message ?? 'Unknown QBO API error';
            const errorCode = qboError?.code ?? error?.response?.status ?? 'UNKNOWN';

            logger.error('QBO API call failed.', {
                error: errorMessage,
                errorCode: errorCode,
                details: qboError?.Detail ?? error?.response?.data ?? error, // Log specific QBO details if available
                stack: error?.stack,
                executionId // This line was already correct
             });
            setState('QBO_API_ERROR');
            const errorDetails = {
                message: errorMessage,
                code: errorCode,
                details: qboError?.Detail ?? error?.response?.data ?? error, // Store response data if available
                statusCode: error?.response?.status
            };
            data.set('qboApiError', errorDetails);

            // TODO: Refine retry logic based on specific error types (e.g., 429 Too Many Requests, 5xx server errors, specific QBO error codes) and action capabilities.
            // Example basic retry check (needs more robust implementation, maybe via platform features or dedicated action)
            const isRetryable = errorCode === '429' || errorCode >= 500; // Basic check for rate limits or server errors
            if (isRetryable) {
                 logger.warn('Potential retryable error detected. Scheduling retry (logic TBD).', { errorCode, executionId }); // This line was already correct
                 // context.scheduleRetry({ delay: '5m' }); // Hypothetical platform feature
                 // For now, create human task even for retryable, as explicit retry isn't implemented here
            }

            // TODO: Define JSON schema for human task form
            await typedActions.createHumanTask({
                taskType: 'qbo_sync_error',
                title: `QBO Invoice Sync Failed for Invoice ID: ${algaInvoice.id}`,
                details: {
                    message: `Failed to ${existingQboInvoiceId ? 'update' : 'create'} invoice ${algaInvoice.id} in QBO for Realm ID ${realmId}. Error Code: ${errorCode}`,
                    algaInvoiceId: algaInvoice.id,
                    qboInvoiceIdAttempted: existingQboInvoiceId,
                    tenantId: tenant, // Use tenant variable
                    realmId: realmId,
                    error: errorDetails, // Include stored error details
                    workflowInstanceId: executionId, // Use executionId variable
                },
                assignedUserId: null, // Or assign based on rules
                tenantId: tenant, // Use tenant variable
            });

            // Update Alga status to reflect failure
             await typedActions.updateInvoiceQboDetails({
                 invoiceId: algaInvoice.id,
                 qboInvoiceId: existingQboInvoiceId, // Keep old ID if update failed
                 qboSyncToken: qboSyncToken, // Keep old token if update failed
                 lastSyncStatus: 'FAILED',
                 lastSyncTimestamp: new Date().toISOString(),
                 lastSyncError: errorDetails,
                 tenantId: tenant // Use tenant variable
             });
        }

    } catch (workflowError: any) {
        logger.error('Unhandled error during QBO Invoice Sync workflow execution.', { error: workflowError?.message, stack: workflowError?.stack, executionId }); // This line was already correct
        setState('WORKFLOW_ERROR');
        // Store error details if possible
        const errorInfo = { message: workflowError?.message, stack: workflowError?.stack };
        data.set('workflowError', errorInfo);

         // Update Alga status if possible
         const algaInvoiceIdForError = data.get<AlgaInvoice>('algaInvoice')?.id ?? triggerPayload?.invoiceId;
         // Use tenant from context
         if (algaInvoiceIdForError && tenant) { // Use tenant variable
             try {
                 await typedActions.updateInvoiceQboDetails({
                     invoiceId: algaInvoiceIdForError,
                     lastSyncStatus: 'FAILED',
                     lastSyncTimestamp: new Date().toISOString(),
                     lastSyncError: { message: "Unhandled workflow error", details: errorInfo },
                     tenantId: tenant // Use tenant variable
                 });
             } catch (updateError: any) {
                 logger.error('Failed to update Alga invoice status after unhandled workflow error.', { updateError: updateError?.message, executionId }); // This line was already correct
             }
         }

        // TODO: Consider creating a generic human task for unhandled workflow errors
         await typedActions.createHumanTask({
             taskType: 'workflow_execution_error',
             title: `Workflow Error in QBO Invoice Sync for Invoice: ${algaInvoiceIdForError ?? 'Unknown'}`,
             details: {
                 message: `An unexpected error occurred during the QBO Invoice Sync workflow execution.`,
                 algaInvoiceId: algaInvoiceIdForError ?? 'Unknown',
                 tenantId: tenant ?? 'Unknown', // Use tenant variable
                 realmId: realmId ?? 'Unknown',
                 workflowInstanceId: executionId, // Use executionId variable
                 error: errorInfo,
             },
             assignedUserId: null,
             tenantId: tenant ?? 'Unknown', // Use tenant variable
         });

    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`); // This line was already correct
    }
}