import { WorkflowContext } from '../../../../shared/workflow/core'; // Assuming path
// TODO: Confirm actual path for WorkflowContext type

// Define placeholder types for data structures until actual types are available
// Use snake_case matching database columns
type AlgaInvoice = { invoice_id: string; company_id: string; qbo_invoice_id?: string; qbo_sync_token?: string; /* ... other fields like invoice_number, status etc */ };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; /* ... other fields */ }; // Use service_id
type AlgaCompany = { company_id: string; qbo_customer_id?: string; qbo_term_id?: string; /* ... other fields */ };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; /* ... other QBO fields */ };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; /* ... other potential payload fields */ }; // Added eventName, realmId/tenantId possibility
type QboApiError = { message: string; details?: any; statusCode?: number };
// Use snake_case for consistency within task details
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant_id: string; realm_id: string; [key: string]: any; };

// Placeholder action types (replace with actual imports/types)
interface WorkflowActions {
    // Action signatures remain the same (param names like 'id', 'invoiceId' are internal to the action call)
    // But the Promise return types now reflect the snake_case structure
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>; // Returns snake_case object
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<AlgaInvoiceItem[]>; // Returns snake_case objects
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>; // Returns snake_case object
    // Assuming lookup returns the ID string directly, no object structure change needed for the Promise type
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; found: boolean; qboItemId?: string; message?: string; }>;
    // lookupQboTaxCodeId: (args: { algaTaxRateId: string; tenantId: string; realmId: string }) => Promise<string | null>;
    // lookupQboTermId: (args: { algaTermId: string; tenantId: string; realmId: string }) => Promise<string | null>;
    // Human task details might internally use snake_case now for consistency
    createHumanTask: (args: { taskType: string; title: string; details: HumanTaskDetails; assignedUserId?: string | null; tenantId: string; }) => Promise<void>;
    triggerWorkflow: (args: { name: string; input: any; tenantId: string; }) => Promise<void>;
    // QBO actions interact with external API, their args/return types are likely based on QBO's structure (often camelCase like Id, SyncToken)
    updateQboInvoice: (args: { qboInvoiceData: QboInvoiceData; qboInvoiceId: string; qboSyncToken: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ Id: string; SyncToken: string }>;
    createQboInvoice: (args: { qboInvoiceData: QboInvoiceData; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ Id: string; SyncToken: string }>;
    // updateInvoiceQboDetails args need to align with the database fields it updates
    updateInvoiceQboDetails: (args: { invoiceId: string; qboInvoiceId?: string | null; qboSyncToken?: string | null; tenantId: string }) => Promise<void>;
    get_secret: (args: { secretName: string; scopeIdentifier: string; tenantId: string; }) => Promise<{ success: boolean; secret?: any; message?: string }>;
    get_external_entity_mapping: (args: {
        algaEntityId: string;
        externalSystemName: 'quickbooks_online';
        externalRealmId: string;
        tenantId: string;
    }) => Promise<{
        success: boolean;
        found: boolean;
        mapping?: { externalEntityId: string; [key: string]: any };
        message?: string;
    }>;
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
    logger.info(`QBO Invoice Sync workflow received input:`, JSON.stringify(input, null, 2)); // Added logging for raw input

    // --- 1. Initialization & Trigger Context ---
    // tenant and executionId are now destructured directly from context
    // The workflow input is the workflow event object itself, not nested under triggerEvent.

    // Access payload directly from input.
    // Assuming 'input' from context IS the event payload object itself.
    const triggerEventPayload = data.get<TriggerEventPayload>('eventPayload');
    const realmId = triggerEventPayload?.realmId; // realmId should be on eventPayload
    const algaInvoiceId = triggerEventPayload?.invoiceId; // invoiceId should be on eventPayload
    // 'event_name' would be on the wrapper event, 'eventName' is in the payload.
    // If the runtime provides context.eventName, that would be better.
    // For now, let's assume we need to get it from the payload if input is payload.
    const triggerEventName = triggerEventPayload?.eventName;

    // Use tenant from context
    if (!tenant || !realmId || !algaInvoiceId) {
        logger.error('Missing critical context: tenant, realmId, or invoiceId from input payload.', { tenant, realmIdFromPayload: realmId, invoiceIdFromPayload: algaInvoiceId, retrievedEventPayload: triggerEventPayload, contextInput: input, executionId });
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
             // Fetch company using company_id from the stored (snake_case) algaInvoice
             const potentiallyUpdatedCompany: AlgaCompany = await typedActions.getCompany({ id: data.get<AlgaInvoice>('algaInvoice')?.company_id!, tenantId: tenant });
             if (potentiallyUpdatedCompany) {
                 data.set('algaCompany', potentiallyUpdatedCompany);
                 // Log using snake_case fields from the fetched company object
                 logger.info('Re-fetched company data upon resuming from customer sync wait.', { company_id: potentiallyUpdatedCompany.company_id, hasQboId: !!potentiallyUpdatedCompany.qbo_customer_id, executionId });
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
            
            logger.info('Inspecting fetched invoice object in workflow:', { invoiceObject: JSON.stringify(invoice, null, 2), executionId });

            // Ensure companyId is available before fetching company/items
            // Check for company_id (snake_case)
            if (!invoice?.company_id) {
                 logger.error('Fetched invoice is missing company_id.', { alga_invoice_id: algaInvoiceId, tenant, executionId });
                 setState('DATA_FETCH_ERROR');
                 return;
            }
            // Pass algaInvoiceId (which holds the UUID) as invoiceId param to getInvoiceItems action
            const invoiceItems: AlgaInvoiceItem[] = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant });
            // Fetch company using company_id from invoice object, pass as 'id' param to getCompany action
            const company: AlgaCompany = await typedActions.getCompany({ id: invoice.company_id, tenantId: tenant });

            if (!invoice || !invoiceItems || !company) {
                // Log using snake_case company_id
                logger.error('Failed to fetch required Alga data.', { alga_invoice_id: algaInvoiceId, company_id: invoice?.company_id, executionId });
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
        // The get_invoice_items action returns { success: boolean, items: AlgaInvoiceItem[] }
        const algaInvoiceItemsResult = data.get<{ success: boolean; items: AlgaInvoiceItem[]; }>('algaInvoiceItems');
        const algaCompany = data.get<AlgaCompany>('algaCompany');
        let qboCustomerIdToUse: string | undefined = algaCompany?.qbo_customer_id; // Initialize here

        // Double-check data presence after fetch/resume logic
        if (!algaInvoice || !algaInvoiceItemsResult || !algaCompany) {
             logger.error('Required data not found in workflow context after fetch/resume.', { algaInvoiceId, executionId }); // This line was already correct
             setState('INTERNAL_ERROR'); // Indicate an unexpected state issue
             return;
        }

        // --- 3. Customer Sync Dependency Check ---
        // Check if we are in a state where this check is needed
        const needsCustomerCheck = ['INITIAL', 'FETCHING_DATA', 'WAITING_FOR_CUSTOMER_SYNC'].includes(getCurrentState() ?? 'INITIAL');

        if (needsCustomerCheck) {
            setState('CHECKING_CUSTOMER_MAPPING');
            // Log using company_id
            logger.info('Checking for QBO Customer mapping.', { company_id: algaCompany.company_id, executionId });

            // qboCustomerIdToUse is already initialized from algaCompany.qbo_customer_id
            // Now, try to confirm/update it using get_external_entity_mapping
            logger.info('Attempting to resolve QBO Customer ID via get_external_entity_mapping.', { company_id: algaCompany.company_id, current_known_id: qboCustomerIdToUse, executionId });
            const mappingResult = await typedActions.get_external_entity_mapping({
                algaEntityId: algaCompany.company_id,
                externalSystemName: 'quickbooks_online',
                externalRealmId: realmId,
                tenantId: tenant,
            });

            if (mappingResult.success) {
                if (mappingResult.found && mappingResult.mapping?.externalEntityId) {
                    qboCustomerIdToUse = mappingResult.mapping.externalEntityId;
                    logger.info('QBO Customer ID found and confirmed/updated via get_external_entity_mapping.', { qbo_customer_id: qboCustomerIdToUse, company_id: algaCompany.company_id, executionId });
                    if (algaCompany.qbo_customer_id !== qboCustomerIdToUse) {
                        logger.info('Updating in-memory algaCompany.qbo_customer_id with mapped ID.', { old_id: algaCompany.qbo_customer_id, new_id: qboCustomerIdToUse, executionId });
                        algaCompany.qbo_customer_id = qboCustomerIdToUse; // Keep in-memory company object consistent if it's used later
                    }
                } else { // Success but not found
                    logger.warn('No QBO Customer mapping found via get_external_entity_mapping. Will trigger Customer Sync.', { company_id: algaCompany.company_id, executionId });
                    qboCustomerIdToUse = undefined; // Explicitly mark as not found for the next step
                }
            } else { // Lookup failed
                logger.error('Failed to lookup QBO Customer mapping via get_external_entity_mapping.', {
                    company_id: algaCompany.company_id,
                    error: mappingResult.message,
                    executionId
                });
                setState('CUSTOMER_MAPPING_LOOKUP_ERROR');
                await typedActions.createHumanTask({
                    taskType: 'qbo_customer_mapping_lookup_error',
                    title: `Failed QBO Customer Mapping Lookup for Company ID: ${algaCompany.company_id}`,
                    details: {
                        message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the mapping system or action.`,
                        alga_company_id: algaCompany.company_id,
                        alga_invoice_id: algaInvoiceId, // algaInvoiceId is in scope
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });

                logger.warn('Skipping updateInvoiceQboDetails for CUSTOMER_MAPPING_LOOKUP_ERROR as no QBO IDs are available and sync status is handled elsewhere.', { algaInvoiceId, tenant });
                return; // Stop workflow
            }

            // Now, check if we need to trigger customer sync based on qboCustomerIdToUse
            if (!qboCustomerIdToUse) {
                logger.warn('QBO Customer ID is definitively missing after mapping check. Triggering Customer Sync.', { company_id: algaCompany.company_id, executionId });
                setState('WAITING_FOR_CUSTOMER_SYNC');
                await typedActions.triggerWorkflow({
                    name: 'qboCustomerSyncWorkflow',
                    input: {
                        triggerEvent: {
                            name: 'CUSTOMER_SYNC_REQUESTED',
                            payload: {
                                company_id: algaCompany.company_id,
                                tenantId: tenant,
                                realmId: realmId,
                                originatingWorkflowInstanceId: executionId
                            }
                        },
                    },
                    tenantId: tenant
                });
                logger.info('Customer Sync workflow triggered. Pausing Invoice Sync.', { executionId });
                return; // Workflow pauses
            } else {
                 logger.info('Proceeding with QBO Customer ID for invoice processing.', { qbo_customer_id: qboCustomerIdToUse, company_id: algaCompany.company_id, executionId });
            }
        }

        // --- 3.5 Fetch QBO Credentials ---
        let qboCredentials = data.get<any>('qboCredentials');
        if (!qboCredentials) {
            setState('FETCHING_QBO_CREDENTIALS');
            logger.info('Fetching QBO credentials using get_secret action.', { realmId, executionId });
            const secretResult = await typedActions.get_secret({
                secretName: 'qbo_credentials', // Changed from 'QBO_CREDENTIALS'
                scopeIdentifier: realmId, // realmId is the scopeIdentifier for QBO credentials
                tenantId: tenant,
            });

            if (!secretResult.success || !secretResult.secret) {
                logger.error('Failed to fetch QBO credentials.', {
                    message: secretResult.message,
                    realmId,
                    executionId,
                });
                setState('SECRET_FETCH_ERROR');
                await typedActions.createHumanTask({
                    taskType: 'secret_fetch_error',
                    title: `Failed to Fetch QBO Credentials for Realm ID: ${realmId}`,
                    details: {
                        message: `The workflow failed to retrieve QBO credentials for Realm ID ${realmId}. Error: ${secretResult.message}. Please check the secret configuration.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });
                // Update Alga invoice status to reflect failure
                //责任分离：见上文关于 CUSTOMER_MAPPING_LOOKUP_ERROR 的注释。
                logger.warn('Skipping updateInvoiceQboDetails for SECRET_FETCH_ERROR as sync status is handled elsewhere.', { algaInvoiceId, tenant });
                return;
            }
            qboCredentials = secretResult.secret;
            data.set('qboCredentials', qboCredentials);
            logger.info('Successfully fetched and stored QBO credentials.', { executionId });
        }


        // --- 4. Data Mapping ---
        // Proceed if customer mapping exists or we resumed past that check
        setState('MAPPING_DATA');
        logger.info('Mapping Alga Invoice data to QBO format.', { executionId }); // This line was already correct

        const qboInvoiceLines: any[] = [];

        // Ensure algaInvoiceItemsResult is an object with a 'success' property and an 'items' array property
        const itemsToIterate = (algaInvoiceItemsResult && algaInvoiceItemsResult.success && Array.isArray(algaInvoiceItemsResult.items))
            ? algaInvoiceItemsResult.items
            : []; // Default to empty array if data is not as expected

        for (const item of itemsToIterate) {
            // Check for product_id (snake_case)
            if (!item.service_id) {
                // Handle description-only lines or items without a service_id
                logger.warn("Invoice line item does not have an associated product ID.", { item_id: item.id, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_mapping_error',
                    title: `Invoice Line Item Missing Product Association`,
                    details: {
                        message: `Cannot sync invoice ${algaInvoice.invoice_id} because line item ${item.id} does not have an associated Alga Product. Please associate a product or handle description-only lines.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_item_id: item.id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });
                continue; // Skip this item, continue with the next
            }

            // Pass service_id as algaProductId param to action
            const mappingResult = await typedActions.lookupQboItemId({ algaProductId: item.service_id, tenantId: tenant, realmId, qboCredentials });

            if (!mappingResult.success) {
                // If lookup action itself failed
                logger.error('QBO Item lookup action failed.', { alga_service_id: item.service_id, tenant, realmId, error: mappingResult.message, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_lookup_failed',
                    title: `QBO Item Lookup Failed for Alga Service ID: ${item.service_id}`,
                    details: {
                        message: `The lookup action for Alga Service ID ${item.service_id} failed for Realm ID ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the lookup action or system.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });
                continue; // Skip this item, continue with the next
            }

            if (!mappingResult.found) {
                // If lookup action succeeded but no mapping was found
                logger.warn('No QBO Item mapping found for Alga Service ID.', { alga_service_id: item.service_id, tenant, realmId, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_mapping_missing',
                    title: `QBO Item Mapping Missing for Alga Service ID: ${item.service_id}`,
                    details: {
                        message: `Cannot sync invoice ${algaInvoice.invoice_id} because Alga Service ID ${item.service_id} is not mapped to a QBO Item for Realm ID ${realmId}. Please map the product in Alga PSA settings.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });
                continue; // Skip this item, continue with the next
            }

            // If lookup succeeded and mapping was found
            const qboItemId = mappingResult.qboItemId;
            if (!qboItemId) {
                // This case should ideally not happen if found is true, but as a safeguard
                logger.error('QBO Item lookup succeeded and found=true, but qboItemId is missing.', { alga_service_id: item.service_id, tenant, realmId, mappingResult, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_lookup_internal_error',
                    title: `Internal Lookup Error for Alga Service ID: ${item.service_id}`,
                    details: {
                        message: `Internal workflow error: QBO Item lookup for Alga Service ID ${item.service_id} reported success but did not return an Item ID. Please investigate the lookup action.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                        mapping_result: mappingResult,
                    },
                    assignedUserId: null,
                    tenantId: tenant,
                });
                continue; // Skip this item
            }

            // TODO: Confirm lookup action name and parameters for TaxCode
            // const qboTaxCodeId = await typedActions.lookupQboTaxCodeId({ algaTaxRateId: item.taxRateId, tenantId: tenant, realmId }); // Use tenant variable
            // if (!qboTaxCodeId) {
            //     logger.error('Failed to map Alga Tax Rate to QBO Tax Code.', { algaTaxRateId: item.taxRateId, executionId }); // This line was already correct
            //     await typedActions.createHumanTask({ /* ... tax code mapping task ... */ });
            //     continue; // Skip this item if tax code mapping is critical
            // }

            // Proceed with creating the QBO line item object
            qboInvoiceLines.push({
                Amount: item.amount ?? 0,
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
        // The loop now uses 'continue' for individual item errors, so we only need to check if any lines were successfully mapped.
        // If qboInvoiceLines.length === 0 and itemsToIterate.length > 0, it means all items failed mapping or there were no items.
        if (qboInvoiceLines.length === 0 && itemsToIterate.length > 0) {
             logger.warn('No line items were successfully mapped to QBO items.', { executionId });
             setState('MAPPING_ERROR'); // Or a more specific state like NO_ITEMS_MAPPED
             // A human task for the overall failure might be redundant if tasks were created per item,
             // but could be useful for clarity. Let's add one for overall failure if no lines mapped.
             await typedActions.createHumanTask({
                 taskType: 'qbo_invoice_no_items_mapped',
                 title: `No QBO Items Mapped for Invoice ID: ${algaInvoice.invoice_id}`,
                 details: {
                     message: `Invoice ${algaInvoice.invoice_id} could not be synced to QBO because none of its line items could be mapped to QBO Items. See other human tasks for specific item mapping issues.`,
                     alga_invoice_id: algaInvoice.invoice_id,
                     tenant_id: tenant,
                     realm_id: realmId,
                     workflow_instance_id: executionId,
                 },
                 assignedUserId: null,
                 tenantId: tenant,
             });
             //责任分离：见上文关于 CUSTOMER_MAPPING_LOOKUP_ERROR 的注释。
             logger.warn('Skipping updateInvoiceQboDetails for MAPPING_ERROR as sync status is handled elsewhere.', { invoiceId: algaInvoice.invoice_id, tenantId: tenant });
             return; // Stop workflow if no items could be mapped
        }

        // If we reach here, at least one line item was successfully mapped.
        logger.info(`Successfully mapped ${qboInvoiceLines.length} line items to QBO format.`, { executionId });

        // TODO: Confirm lookup action name and parameters for Term (likely from Company)
        // const qboTermId = await typedActions.lookupQboTermId({ algaTermId: algaCompany.termId, tenantId: tenant, realmId }); // Use tenant variable
         const qboTermId = algaCompany.qbo_term_id; // Assuming direct mapping stored on company for now
         if (!qboTermId) {
             // Log using company_id
             logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { company_id: algaCompany.company_id, executionId });
             // Decide if this is critical - maybe QBO uses a default?
         }


        // At this point, if the workflow hasn't returned due to missing customer ID, qboCustomerIdToUse should be set.
        if (!qboCustomerIdToUse) {
            logger.error('Critical: QBO Customer ID not resolved before mapping QBO invoice data. This indicates an unexpected workflow state.', { company_id: algaCompany!.company_id, invoice_id: algaInvoice!.invoice_id, executionId });
            setState('INTERNAL_ERROR_CUSTOMER_ID_MISSING');
            await typedActions.createHumanTask({
                taskType: 'internal_workflow_error',
                title: `Critical Error: QBO Customer ID Missing for Invoice ${algaInvoice!.invoice_id}`,
                details: {
                    message: `The QBO Invoice Sync workflow reached the data mapping stage for invoice ${algaInvoice!.invoice_id} (Company ID: ${algaCompany!.company_id}) without a resolved QBO Customer ID. This should have been handled by earlier checks. Please investigate workflow logic.`,
                    alga_invoice_id: algaInvoice!.invoice_id,
                    alga_company_id: algaCompany!.company_id,
                    tenant_id: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
                assignedUserId: null, // Assign to admin/devops
                tenantId: tenant,
            });
            //责任分离：见上文关于 CUSTOMER_MAPPING_LOOKUP_ERROR 的注释。
            logger.warn('Skipping updateInvoiceQboDetails for INTERNAL_ERROR_CUSTOMER_ID_MISSING as sync status is handled elsewhere.', { invoiceId: algaInvoice!.invoice_id, tenantId: tenant });
            return; // Stop workflow
        }

        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: qboCustomerIdToUse }, // Use the resolved qboCustomerIdToUse. The ! is removed as it's now guaranteed by the check above.
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
        // These are already snake_case
        const existingQboInvoiceId = algaInvoice.qbo_invoice_id;
        const qboSyncToken = algaInvoice.qbo_sync_token;

        try {
            let qboResult: { Id: string; SyncToken: string };

            // Check using snake_case vars
            if (existingQboInvoiceId && qboSyncToken) {
                // --- Update Existing QBO Invoice ---
                setState('CALLING_QBO_UPDATE');
                // Log using snake_case qbo_invoice_id
                logger.info('Calling QBO API to update existing invoice.', { qbo_invoice_id: existingQboInvoiceId, executionId });
                // TODO: Confirm action name and parameters for update
                // Use tenant from context
                // Action parameters qboInvoiceId, qboSyncToken match action definition
                qboResult = await typedActions.updateQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    qboInvoiceId: existingQboInvoiceId, // Pass snake_case value as camelCase param
                    qboSyncToken: qboSyncToken, // Pass snake_case value as camelCase param
                    tenantId: tenant, // Use tenant variable
                    realmId: realmId,
                    qboCredentials
                });
                // Log using qboResult.Id (likely camelCase from QBO API)
                logger.info('Successfully updated invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });

            } else {
                // --- Create New QBO Invoice ---
                setState('CALLING_QBO_CREATE');
                logger.info('Calling QBO API to create new invoice.', { executionId }); // This line was already correct
                 // TODO: Confirm action name and parameters for create
                 // Use tenant from context
                qboResult = await typedActions.createQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    tenantId: tenant, // Use tenant variable
                    realmId: realmId,
                    qboCredentials
                });
                // Log using qboResult.Id (likely camelCase from QBO API)
                logger.info('Successfully created invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });
            }

            // --- 6. Update Alga PSA Record ---
            setState('UPDATING_ALGA');
            // Log using snake_case alga_invoice_id and camelCase qboResult.Id
            logger.info('Updating Alga PSA invoice with QBO details.', { alga_invoice_id: algaInvoice.invoice_id, qbo_invoice_id: qboResult.Id, executionId });
            // TODO: Confirm action name and parameters for updating Alga
            // Use tenant from context
            // Pass snake_case args to action
            await typedActions.updateInvoiceQboDetails({
                invoiceId: algaInvoice.invoice_id,
                qboInvoiceId: qboResult.Id, // QBO result ID
                qboSyncToken: qboResult.SyncToken, // QBO result token
                tenantId: tenant // Use tenant variable
            });
            // TODO: Add separate action call here to update tenant_external_entity_mappings
            // with lastSyncStatus: 'SUCCESS', lastSyncTimestamp, lastSyncError: null
            logger.info('Successfully updated Alga invoice with QBO IDs. Sync status update in mapping table is pending new action.', { invoiceId: algaInvoice.invoice_id });

            setState('SYNC_COMPLETE');
            // Log using snake_case alga_invoice_id and camelCase qboResult.Id
            logger.info('QBO Invoice sync successful.', { alga_invoice_id: algaInvoice.invoice_id, qbo_invoice_id: qboResult.Id, executionId });

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
                // Use snake_case invoice_id in title and details
                title: `QBO Invoice Sync Failed for Invoice ID: ${algaInvoice.invoice_id}`,
                details: {
                    message: `Failed to ${existingQboInvoiceId ? 'update' : 'create'} invoice ${algaInvoice.invoice_id} in QBO for Realm ID ${realmId}. Error Code: ${errorCode}`,
                    alga_invoice_id: algaInvoice.invoice_id,
                    qbo_invoice_id_attempted: existingQboInvoiceId,
                    tenant_id: tenant, // Use snake_case
                    realm_id: realmId, // Use snake_case
                    error: errorDetails,
                    workflow_instance_id: executionId,
                },
                assignedUserId: null, // Or assign based on rules
                tenantId: tenant, // Use tenant variable
            });

            // Update Alga status to reflect failure
             // Pass snake_case args to action
             //责任分离：仅更新 QBO ID（如果适用）。错误状态应在映射表中处理。
             if (existingQboInvoiceId) { // Only update if we were trying to update an existing QBO invoice
                 await typedActions.updateInvoiceQboDetails({
                     invoiceId: algaInvoiceId,
                     qboInvoiceId: existingQboInvoiceId,
                     qboSyncToken: qboSyncToken,
                     tenantId: tenant
                 });
                 logger.info('Retained existing QBO IDs on Alga invoice after QBO API error. Sync status update in mapping table is pending new action for error state.', { algaInvoiceId });
             } else {
                 logger.warn('No existing QBO IDs to update on Alga invoice after QBO API creation error. Sync status update in mapping table is pending new action for error state.', { algaInvoiceId });
             }
            // TODO: Add separate action call here to update tenant_external_entity_mappings
            // with lastSyncStatus: 'FAILED', lastSyncTimestamp, lastSyncError: errorDetails
        }

    } catch (workflowError: any) {
        logger.error('Unhandled error during QBO Invoice Sync workflow execution.', { error: workflowError?.message, stack: workflowError?.stack, executionId }); // This line was already correct
        setState('WORKFLOW_ERROR');
        // Store error details if possible
        const errorInfo = { message: workflowError?.message, stack: workflowError?.stack };
        data.set('workflowError', errorInfo);

         // Update Alga status if possible
         // Use snake_case invoice_id
         const algaInvoiceIdForError = data.get<AlgaInvoice>('algaInvoice')?.invoice_id ?? triggerEventPayload?.invoiceId; // Use invoiceId from payload as fallback
         // Use tenant from context
         if (algaInvoiceIdForError && tenant) { // Use tenant variable
             try {
                 // Pass snake_case args to action
                 //责任分离：见上文关于 QBO_API_ERROR 的注释。
                 logger.warn('Skipping updateInvoiceQboDetails for WORKFLOW_ERROR as sync status is handled elsewhere. A separate action should update the mapping table.', { algaInvoiceIdForError, tenantId: tenant });
                 // TODO: Add separate action call here to update tenant_external_entity_mappings
                 // with lastSyncStatus: 'FAILED', lastSyncTimestamp, lastSyncError: { message: "Unhandled workflow error", details: errorInfo }
             } catch (updateError: any) {
                 logger.error('Failed to update Alga invoice status after unhandled workflow error.', { updateError: updateError?.message, executionId }); // This line was already correct
             }
         }

        // TODO: Consider creating a generic human task for unhandled workflow errors
         await typedActions.createHumanTask({
             taskType: 'workflow_execution_error',
             // Use snake_case invoice_id in title and details
             title: `Workflow Error in QBO Invoice Sync for Invoice: ${algaInvoiceIdForError ?? 'Unknown'}`,
             details: {
                 message: `An unexpected error occurred during the QBO Invoice Sync workflow execution.`,
                 alga_invoice_id: algaInvoiceIdForError ?? 'Unknown',
                 tenant_id: tenant ?? 'Unknown', // Use snake_case
                 realm_id: realmId ?? 'Unknown', // Use snake_case
                 workflow_instance_id: executionId,
                 error: errorInfo,
             },
             assignedUserId: null,
             tenantId: tenant ?? 'Unknown', // Use tenant variable
         });

    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`); // This line was already correct
    }
}