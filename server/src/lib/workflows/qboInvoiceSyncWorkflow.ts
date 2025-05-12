import { WorkflowContext } from '../../../../shared/workflow/core';
import { TaskEventNames } from '../../../../shared/workflow/persistence/taskInboxInterfaces'; // Added import

type AlgaInvoice = { invoice_id: string; invoice_number: string; company_id: string; qbo_invoice_id?: string; qbo_sync_token?: string; };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; service_name?: string; };
type AlgaCompany = { company_id: string; company_name?: string; qbo_customer_id?: string; qbo_term_id?: string; }; // Added company_name
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; };
type QboApiError = { message: string; details?: any; statusCode?: number };
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant_id: string; realm_id: string;[key: string]: any; };

interface WorkflowActions {
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>;
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<{ success: boolean; items: AlgaInvoiceItem[]; message?: string; error?: any; }>;
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>;
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; found: boolean; qboItemId?: string; message?: string; }>;
    create_human_task: (args: { taskType: string; title: string; description?: string; priority?: string; dueDate?: string; assignTo?: { roles?: string[]; users?: string[] }; contextData?: any; }) => Promise<{ success: boolean; taskId: string }>;
    triggerWorkflow: (args: { name: string; input: any; tenantId: string; }) => Promise<void>;
    updateQboInvoice: (args: { qboInvoiceData: QboInvoiceData; qboInvoiceId: string; qboSyncToken: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ Id: string; SyncToken: string }>;
    createQboInvoice: (args: { qboInvoiceData: QboInvoiceData; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ Id: string; SyncToken: string }>;
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
        mapping?: { externalEntityId: string;[key: string]: any };
        message?: string;
    }>;
}

/**
 * Workflow to synchronize an Alga PSA Invoice with QuickBooks Online.
 * Triggered by INVOICE_CREATED or INVOICE_UPDATED events.
 */
export async function qboInvoiceSyncWorkflow(context: WorkflowContext): Promise<void> {
    const { actions, data, events, logger, input, setState, getCurrentState, tenant, executionId, userId } = context;
    const typedActions = actions as WorkflowActions;
    const currentState = getCurrentState();

    logger.info(`QBO Invoice Sync workflow starting/resuming. Instance ID: ${executionId}. Current state: ${currentState ?? 'INITIAL'}`);
    logger.info(`QBO Invoice Sync workflow received input:`, JSON.stringify(input, null, 2));

    // Log user context information
    logger.info('QBO Invoice Sync workflow user context:', {
        contextUserId: userId,
        inputTriggerEventUserId: input?.triggerEvent?.user_id,
        inputTriggerEventPayloadUserId: input?.triggerEvent?.payload?.userId,
        executionId
    });

    const triggerEventPayload = data.get<TriggerEventPayload>('eventPayload');
    const realmId = triggerEventPayload?.realmId;
    const algaInvoiceId = triggerEventPayload?.invoiceId;
    const triggerEventName = triggerEventPayload?.eventName;

    if (!tenant || !realmId || !algaInvoiceId) {
        logger.error('Missing critical context: tenant, realmId, or invoiceId from input payload.', { tenant, realmIdFromPayload: realmId, invoiceIdFromPayload: algaInvoiceId, retrievedEventPayload: triggerEventPayload, contextInput: input, executionId });
        setState('FAILED_INITIALIZATION');
        return;
    }

    if (currentState === null) {
        setState('INITIAL');
        // Store initial payload if starting fresh, with checks for safety
        if (input?.triggerEvent?.payload) {
            data.set('eventPayload', input.triggerEvent.payload);
        } else {
            // This case should ideally not happen if triggered by an event, but handle defensively.
            logger.error('Initial workflow execution missing expected input.triggerEvent.payload.', { executionId, input });
            // Decide how to handle: fail, or try to continue if payload was already derived?
            // For now, let's rely on the initial check for tenant/realmId/invoiceId derived from data.get('eventPayload')
            // If that check passed, maybe the payload was already set somehow? Or maybe it failed?
            // Let's assume the initial check is sufficient and log a warning.
            if (!triggerEventPayload) {
                 logger.error('Critical error: triggerEventPayload is null/undefined even after initial checks. Cannot proceed.', { executionId });
                 setState('FAILED_INITIALIZATION');
                 return; // Cannot proceed without payload info
            }
             logger.warn('Input trigger event payload was not directly available, but continuing as essential data was derived.', { executionId });
        }
    }

    logger.info('Workflow context initialized.', { tenant, realmId, triggerEventName, algaInvoiceId, executionId });

    // --- Main Workflow Logic ---
    try {
        // --- Data Fetching Stage ---
        // Only fetch if data isn't already in context (handles resumes)
        if (!data.get('algaInvoice') || !data.get('algaInvoiceItems') || !data.get('algaCompany')) {
            setState('FETCHING_DATA');
            logger.info('Fetching initial data.', { executionId });

            const invoice: AlgaInvoice = await typedActions.getInvoice({ id: algaInvoiceId, tenantId: tenant });
            logger.info('Inspecting fetched invoice object in workflow:', { invoiceObject: JSON.stringify(invoice, null, 2), executionId });
            if (!invoice?.company_id) {
                logger.error('Fetched invoice is missing company_id.', { alga_invoice_id: algaInvoiceId, tenant, executionId });
                setState('DATA_FETCH_ERROR'); return;
            }

            const invoiceItemsResult = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant });
            if (!invoiceItemsResult || !invoiceItemsResult.success) {
                logger.error('Failed to fetch invoice items or action reported failure.', { alga_invoice_id: algaInvoiceId, tenant, result: invoiceItemsResult, executionId });
                setState('DATA_FETCH_ERROR'); return;
            }
            const actualInvoiceItemsArray = invoiceItemsResult.items;

            const company: AlgaCompany = await typedActions.getCompany({ id: invoice.company_id, tenantId: tenant });
            if (!company) {
                 logger.error('Failed to fetch company data.', { company_id: invoice.company_id, executionId });
                 setState('DATA_FETCH_ERROR'); return;
            }

            data.set('algaInvoice', invoice);
            data.set('algaInvoiceItems', actualInvoiceItemsArray);
            data.set('algaCompany', company);
            logger.info('Initial data fetched and stored.', { executionId });
        }

        // Retrieve data from context for use
        let algaInvoice = data.get<AlgaInvoice>('algaInvoice')!; // Assume non-null after fetch/resume
        let algaInvoiceItems = data.get<AlgaInvoiceItem[]>('algaInvoiceItems')!;
        let algaCompany = data.get<AlgaCompany>('algaCompany')!;
        let qboCustomerIdToUse: string | undefined = algaCompany.qbo_customer_id;

        // --- Customer Mapping Check Stage ---
        // Check if we need to validate/find the customer mapping
        const needsCustomerCheck = ['INITIAL', 'FETCHING_DATA', 'WAITING_FOR_CUSTOMER_SYNC', 'CHECKING_CUSTOMER_MAPPING'].includes(getCurrentState() ?? 'INITIAL');

        if (needsCustomerCheck) {
            setState('CHECKING_CUSTOMER_MAPPING');
            logger.info('Checking QBO Customer mapping.', { company_id: algaCompany.company_id, executionId });

            let mappingFound = false;
            while (!mappingFound) { // Loop for retry logic
                const mappingResult = await typedActions.get_external_entity_mapping({
                    algaEntityId: algaCompany.company_id,
                    externalSystemName: 'quickbooks_online',
                    externalRealmId: realmId,
                    tenantId: tenant,
                });

                if (mappingResult.success) {
                    if (mappingResult.found && mappingResult.mapping?.externalEntityId) {
                        qboCustomerIdToUse = mappingResult.mapping.externalEntityId;
                        logger.info('QBO Customer ID found/confirmed via mapping.', { qbo_customer_id: qboCustomerIdToUse, company_id: algaCompany.company_id, executionId });
                        if (algaCompany.qbo_customer_id !== qboCustomerIdToUse) {
                            algaCompany.qbo_customer_id = qboCustomerIdToUse; // Update in-memory object
                            data.set('algaCompany', algaCompany); // Update context
                        }
                        mappingFound = true; // Exit loop
                        break; // Explicitly break loop
                    } else {
                        logger.warn('No QBO Customer mapping found. Triggering Customer Sync.', { company_id: algaCompany.company_id, executionId });
                        qboCustomerIdToUse = undefined;
                        mappingFound = false; // Stay in loop (will trigger sync below)
                        break; // Exit mapping check, proceed to sync trigger
                    }
                } else {
                    // Mapping lookup action failed - create human task
                    logger.error('Failed to lookup QBO Customer mapping.', { company_id: algaCompany.company_id, error: mappingResult.message, executionId });
                    setState('CUSTOMER_MAPPING_LOOKUP_ERROR'); // Set state before task creation

                    try {
                        const taskResult = await typedActions.create_human_task({
                            taskType: 'qbo_customer_mapping_lookup_error',
                            title: `Failed QuickBooks Customer Mapping Lookup for Invoice #${algaInvoice.invoice_number}`,
                            description: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the mapping system or action.`,
                            priority: 'high',
                            assignTo: userId ? { users: [userId] } : undefined,
                            contextData: {
                                message: `Failed to lookup QBO Customer mapping for Alga Company ID ${algaCompany.company_id}. Error: ${mappingResult.message || 'Unknown error'}.`,
                                alga_company_id: algaCompany.company_id,
                                alga_invoice_id: algaInvoiceId,
                                tenant_id: tenant,
                                realm_id: realmId,
                                workflow_instance_id: executionId,
                                error_details: mappingResult.message
                            }
                        });

                        if (!taskResult.success || !taskResult.taskId) {
                            logger.error('Failed to create human task for customer mapping error.', { executionId });
                            setState('WORKFLOW_ERROR'); return;
                        }
                        const taskId = taskResult.taskId;
                        logger.info(`Human task created (${taskId}) for customer mapping error. Waiting...`, { executionId });

                        const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                        const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };

                        if (payload?.userAction === 'fixed') {
                            logger.info(`User fixed customer mapping issue (Task ${taskId}). Retrying lookup.`, { executionId });
                            // Loop continues, will re-attempt get_external_entity_mapping
                        } else {
                            logger.warn(`User cancelled customer mapping task ${taskId}. Terminating.`, { executionId });
                            setState('USER_CANCELLED'); return;
                        }
                    } catch (taskError: any) {
                        logger.error('Error handling customer mapping human task.', { error: taskError.message, executionId });
                        setState('WORKFLOW_ERROR'); return;
                    }
                }
            } // End while(!mappingFound)

            // If mapping still not found after check/retry, trigger sync
            if (!qboCustomerIdToUse) {
                logger.warn('QBO Customer ID missing after check. Triggering Customer Sync.', { company_id: algaCompany.company_id, executionId });
                setState('WAITING_FOR_CUSTOMER_SYNC');
                await typedActions.triggerWorkflow({
                    name: 'qboCustomerSyncWorkflow',
                    input: { triggerEvent: { name: 'CUSTOMER_SYNC_REQUESTED', payload: { company_id: algaCompany.company_id, tenantId: tenant, realmId: realmId, originatingWorkflowInstanceId: executionId } } },
                    tenantId: tenant
                });
                // Wait for the customer sync workflow to potentially update the mapping
                // This requires the sync workflow to emit an event this workflow can wait for, e.g., 'CUSTOMER_SYNC_COMPLETED'
                // For now, we assume it updates the mapping table and we re-fetch on resume.
                // A more robust solution involves waiting for a specific event.
                // Let's assume a simple resume mechanism for now:
                logger.info('Waiting for potential customer sync completion (will resume on next trigger/event).', { executionId });
                return; // Pause workflow, expecting resume
            }
        } else if (currentState === 'WAITING_FOR_CUSTOMER_SYNC') {
             // Resuming after customer sync trigger
             logger.info('Resuming after triggering customer sync. Re-fetching company data.', { executionId });
             try {
                 algaCompany = await typedActions.getCompany({ id: algaCompany.company_id, tenantId: tenant });
                 data.set('algaCompany', algaCompany);
                 qboCustomerIdToUse = algaCompany.qbo_customer_id;
                 if (!qboCustomerIdToUse) {
                     logger.error('Customer ID still missing after resuming from sync wait.', { executionId });
                     // Potentially create another task or fail permanently
                     setState('CUSTOMER_MAPPING_LOOKUP_ERROR'); // Re-enter error state
                     // Consider creating a task here again if needed
                     return;
                 }
                 logger.info('Successfully re-fetched company data, QBO Customer ID found.', { qboCustomerIdToUse, executionId });
                 setState('CHECKING_CUSTOMER_MAPPING'); // Go back to mapping check state to confirm
             } catch (fetchError: any) {
                 logger.error('Error re-fetching company data after sync wait.', { error: fetchError.message, executionId });
                 setState('DATA_FETCH_ERROR'); return;
             }
        }

        // --- Credential Fetch Stage ---
        let qboCredentials = data.get<any>('qboCredentials');
        if (!qboCredentials) {
            setState('FETCHING_QBO_CREDENTIALS');
            logger.info('Fetching QBO credentials.', { executionId });

            let credsFetched = false;
            while (!credsFetched) { // Loop for retry
                const secretResult = await typedActions.get_secret({
                    secretName: 'qbo_credentials',
                    scopeIdentifier: realmId,
                    tenantId: tenant,
                });

                if (secretResult.success && secretResult.secret) {
                    qboCredentials = secretResult.secret;
                    data.set('qboCredentials', qboCredentials);
                    logger.info('QBO credentials fetched successfully.', { executionId });
                    credsFetched = true; // Exit loop
                } else {
                    // Secret fetch failed - create human task
                    logger.error('Failed to fetch QBO credentials.', { message: secretResult.message, realmId, executionId });
                    setState('SECRET_FETCH_ERROR');

                    try {
                        const taskResult = await typedActions.create_human_task({
                            taskType: 'secret_fetch_error',
                            title: `QuickBooks Authentication Error - Invoice ${algaInvoiceId}`,
                            description: `Could not retrieve QuickBooks credentials needed to sync invoice ${algaInvoiceId}. Error: ${secretResult.message || 'Unknown error'}. Please check QBO connection settings.`,
                            priority: 'high',
                            assignTo: userId ? { users: [userId] } : undefined,
                            contextData: {
                                message: `Failed to fetch QBO credentials. Error: ${secretResult.message || 'Unknown error'}.`,
                                alga_invoice_id: algaInvoiceId,
                                tenant_id: tenant,
                                realm_id: realmId,
                                workflow_instance_id: executionId,
                                secret_name: 'qbo_credentials'
                            }
                        });

                        if (!taskResult.success || !taskResult.taskId) {
                            logger.error('Failed to create human task for secret fetch error.', { executionId });
                            setState('WORKFLOW_ERROR'); return;
                        }
                        const taskId = taskResult.taskId;
                        logger.info(`Human task created (${taskId}) for secret fetch error. Waiting...`, { executionId });

                        const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                        const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };

                        if (payload?.userAction === 'fixed') {
                            logger.info(`User fixed secret fetch issue (Task ${taskId}). Retrying fetch.`, { executionId });
                            // Loop continues, will re-attempt get_secret
                        } else {
                            logger.warn(`User cancelled secret fetch task ${taskId}. Terminating.`, { executionId });
                            setState('USER_CANCELLED'); return;
                        }
                    } catch (taskError: any) {
                        logger.error('Error handling secret fetch human task.', { error: taskError.message, executionId });
                        setState('WORKFLOW_ERROR'); return;
                    }
                }
            } // End while(!credsFetched)
        }

        // --- Item Mapping Stage ---
        setState('MAPPING_DATA');
        logger.info('Starting item mapping.', { itemCount: algaInvoiceItems.length, executionId });
        const qboInvoiceLines: any[] = [];
        let itemMappingErrorOccurred = false; // Flag to track if any item failed mapping

        for (let i = 0; i < algaInvoiceItems.length; i++) {
            const item = algaInvoiceItems[i];
            let itemMapped = false;

            if (!item.service_id) {
                logger.warn(`Item missing service_id (index ${i}). Creating task.`, { itemId: item.id, executionId });
                itemMappingErrorOccurred = true; // Mark error
                // Create task for missing service_id (similar structure to others)
                try {
                     const taskResult = await typedActions.create_human_task({
                         taskType: 'qbo_mapping_error', // Use existing generic mapping error type
                         title: `Item Missing Product/Service ID - Invoice #${algaInvoice.invoice_number}`,
                         description: `An item (ID: ${item.id}, Name: "${item.service_name || 'N/A'}") on invoice #${algaInvoice.invoice_number} is missing its associated Alga Product/Service ID. Please update the invoice item to associate it with a product/service.`,
                         priority: 'medium',
                         assignTo: userId ? { users: [userId] } : undefined,
                         contextData: {
                             message: `Item (ID: ${item.id}) on invoice #${algaInvoice.invoice_number} is missing its Alga Product/Service ID.`,
                             alga_invoice_id: algaInvoiceId,
                             alga_invoice_item_id: item.id,
                             item_description: item.service_name, // Use service_name
                             tenant_id: tenant,
                             realm_id: realmId,
                             workflow_instance_id: executionId
                         }
                     });
                     if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                     const taskId = taskResult.taskId;
                     logger.info(`Task ${taskId} created for missing service_id. Waiting...`, { executionId });
                     const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                     const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                     if (payload?.userAction === 'fixed') {
                         logger.info(`User fixed missing service_id (Task ${taskId}). Re-fetching items.`, { executionId });
                         // Re-fetch ALL items to get the update
                         const refreshResult = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant });
                         if (refreshResult.success) {
                             algaInvoiceItems = refreshResult.items;
                             data.set('algaInvoiceItems', algaInvoiceItems);
                             i = -1; // Restart loop from the beginning with refreshed items
                             itemMappingErrorOccurred = false; // Reset flag as we are restarting
                             logger.info('Restarting item loop with refreshed items.', { executionId });
                             continue; // Go to next iteration (which will be index 0)
                         } else {
                             logger.error('Failed to re-fetch items after fix.', { executionId });
                             setState('WORKFLOW_ERROR'); return;
                         }
                     } else {
                         logger.warn(`User cancelled missing service_id task ${taskId}. Terminating.`, { executionId });
                         setState('USER_CANCELLED'); return;
                     }
                } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                continue; // Skip to next item if task wasn't fixed or error occurred
            }

            // Loop for retrying lookup for a specific item
            let lookupAttempt = 0;
            const maxLookupAttempts = 2; // Allow one retry after user fix
            while (!itemMapped && lookupAttempt < maxLookupAttempts) {
                lookupAttempt++;
                logger.info(`Attempt ${lookupAttempt}: Looking up QBO item for service ID ${item.service_id}.`, { executionId });
                const mappingResult = await typedActions.lookupQboItemId({ algaProductId: item.service_id, tenantId: tenant, realmId, qboCredentials });

                if (mappingResult.success) {
                    if (mappingResult.found && mappingResult.qboItemId) {
                        logger.info(`Successfully mapped item (index ${i}) to QBO Item ID ${mappingResult.qboItemId}.`, { executionId });
                        qboInvoiceLines.push({
                            Amount: item.amount ?? 0,
                            DetailType: "SalesItemLineDetail",
                            SalesItemLineDetail: { ItemRef: { value: mappingResult.qboItemId } },
                        });
                        itemMapped = true; // Exit retry loop for this item
                    } else if (mappingResult.found) { // Found but no ID -> Internal Error
                         logger.error(`Internal Error: Lookup succeeded but QBO Item ID missing for service ID ${item.service_id}.`, { executionId });
                         itemMappingErrorOccurred = true;
                         // Create task for internal lookup error (similar structure)
                         try {
                             const taskResult = await typedActions.create_human_task({
                                 taskType: 'qbo_item_lookup_internal_error',
                                 title: `System Error: QBO Item Lookup - Invoice #${algaInvoice.invoice_number}`,
                                 description: `An internal error occurred during QuickBooks item lookup for Alga Product/Service ID ${item.service_id} (Item: "${item.service_name || 'N/A'}") on invoice #${algaInvoice.invoice_number}. The system indicated success but did not return a QBO Item ID. Please report to support.`,
                                 priority: 'high',
                                 assignTo: userId ? { users: [userId] } : undefined,
                                 contextData: {
                                     message: `Internal error during QBO item lookup for Alga Product/Service ID ${item.service_id}. Success reported but no QBO Item ID returned.`,
                                     alga_invoice_id: algaInvoiceId,
                                     alga_service_id: item.service_id,
                                     item_description: item.service_name, // Use service_name
                                     tenant_id: tenant,
                                     realm_id: realmId,
                                     workflow_instance_id: executionId
                                 }
                             });
                             if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                             const taskId = taskResult.taskId;
                             logger.info(`Task ${taskId} created for internal item lookup error. Waiting...`, { executionId });
                             const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                             const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                             if (payload?.userAction === 'fixed') {
                                 logger.info(`User fixed internal lookup error (Task ${taskId}). Retrying lookup (Attempt ${lookupAttempt + 1}).`, { executionId });
                                 // Loop continues for retry
                             } else {
                                 logger.warn(`User cancelled internal lookup error task ${taskId}. Terminating.`, { executionId });
                                 setState('USER_CANCELLED'); return;
                             }
                         } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                    } else { // Not found -> Mapping Error
                        logger.warn(`QBO Item mapping not found for service ID ${item.service_id}. Creating task.`, { executionId });
                        itemMappingErrorOccurred = true;
                        // Create task for mapping error (similar structure)
                         try {
                             const taskResult = await typedActions.create_human_task({
                                 taskType: 'qbo_mapping_error', // Use existing generic mapping error type
                                 title: `Product Not Mapped to QBO - Invoice ${algaInvoice.invoice_number}`,
                                 description: `Alga Product/Service ID ${item.service_id} (Item: "${item.service_name || 'N/A'}") on invoice #${algaInvoice.invoice_number} is not mapped to a QuickBooks item. Please map this product/service in the QBO integration settings.`,
                                 priority: 'medium',
                                 assignTo: userId ? { users: [userId] } : undefined,
                                 contextData: {
                                     message: `Alga Product/Service ID ${item.service_id} is not mapped to a QBO item.`,
                                     alga_invoice_id: algaInvoiceId,
                                     alga_service_id: item.service_id,
                                     service_name: item.service_name, 
                                     company_name: algaCompany.company_name, // Ensure company_name is included
                                     alga_company_id: algaCompany.company_id, // Ensure alga_company_id is included
                                     tenant_id: tenant,
                                     realm_id: realmId,
                                     workflow_instance_id: executionId
                                 }
                             });
                             if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                             const taskId = taskResult.taskId;
                             logger.info(`Task ${taskId} created for item mapping error. Waiting...`, { executionId });
                             const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                             const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                             if (payload?.userAction === 'fixed') {
                                 logger.info(`User fixed item mapping error (Task ${taskId}). Retrying lookup (Attempt ${lookupAttempt + 1}).`, { executionId });
                                 // Loop continues for retry
                             } else {
                                 logger.warn(`User cancelled item mapping error task ${taskId}. Terminating.`, { executionId });
                                 setState('USER_CANCELLED'); return;
                             }
                         } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                    }
                } else { // Lookup action itself failed
                    logger.error(`QBO Item lookup action failed for service ID ${item.service_id}. Error: ${mappingResult.message}`, { executionId });
                    itemMappingErrorOccurred = true;
                    // Create task for lookup failure (similar structure)
                     try {
                         const taskResult = await typedActions.create_human_task({
                             taskType: 'qbo_item_lookup_failed',
                             title: `QBO Item Lookup Failed - Invoice #${algaInvoice.invoice_number}`,
                             description: `The action to look up the QuickBooks item for Alga Product/Service ID ${item.service_id} (Item: "${item.service_name || 'N/A'}") failed. Error: ${mappingResult.message || 'Unknown error'}. Please check system logs or QBO connection.`,
                             priority: 'high',
                             assignTo: userId ? { users: [userId] } : undefined,
                             contextData: {
                                 message: `QBO Item lookup action failed for Alga Product/Service ID ${item.service_id}. Error: ${mappingResult.message || 'Unknown error'}.`,
                                 alga_invoice_id: algaInvoiceId,
                                 alga_service_id: item.service_id,
                                 item_description: item.service_name, // Use service_name
                                 error_details: mappingResult.message,
                                 tenant_id: tenant,
                                 realm_id: realmId,
                                 workflow_instance_id: executionId
                             }
                         });
                         if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                         const taskId = taskResult.taskId;
                         logger.info(`Task ${taskId} created for item lookup failure. Waiting...`, { executionId });
                         const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                         const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                         if (payload?.userAction === 'fixed') {
                             logger.info(`User fixed item lookup failure (Task ${taskId}). Retrying lookup (Attempt ${lookupAttempt + 1}).`, { executionId });
                             // Loop continues for retry
                         } else {
                             logger.warn(`User cancelled item lookup failure task ${taskId}. Terminating.`, { executionId });
                             setState('USER_CANCELLED'); return;
                         }
                     } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                }

                // If max attempts reached and still not mapped, break inner loop and let outer logic handle it
                if (!itemMapped && lookupAttempt >= maxLookupAttempts) {
                    logger.error(`Max lookup attempts reached for item service ID ${item.service_id}. Failing item mapping.`, { executionId });
                    itemMappingErrorOccurred = true; // Ensure error is flagged
                    break; // Exit retry loop for this item
                }
            } // End while(!itemMapped) for item lookup retry

            // If after retries the item is still not mapped, stop processing items
            if (!itemMapped) {
                 logger.error(`Failed to map item (index ${i}, service ID ${item.service_id}) after potential retries. Stopping item processing.`, { executionId });
                 break; // Exit the main item loop
            }
        } // End for loop over items

        // Check if any item mapping failed after the loop
        if (itemMappingErrorOccurred) {
            logger.error('One or more items failed to map after retries. Creating final mapping error task.', { executionId });
            setState('MAPPING_ERROR');
            // Create the 'qbo_invoice_no_items_mapped' task
            try {
                const taskResult = await typedActions.create_human_task({
                    taskType: 'qbo_invoice_no_items_mapped',
                    title: `Product Mapping Issues - Invoice #${algaInvoice.invoice_number}`,
                    description: `One or more products on invoice #${algaInvoice.invoice_number} could not be mapped to QuickBooks items after attempts. Please review the individual item mapping errors or ensure all products are correctly mapped in QBO settings.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `One or more items failed to map after retries for invoice #${algaInvoice.invoice_number}.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId
                    }
                });
                if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                const taskId = taskResult.taskId;
                logger.info(`Task ${taskId} created for overall item mapping failure. Waiting...`, { executionId });
                const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                if (payload?.userAction === 'fixed') {
                    logger.info(`User fixed overall mapping issue (Task ${taskId}). Restarting mapping phase.`, { executionId });
                    setState('FETCHING_DATA'); // Restart from fetching data to ensure all items/mappings are fresh
                    return; // Restart workflow execution
                } else {
                    logger.warn(`User cancelled overall mapping task ${taskId}. Terminating.`, { executionId });
                    setState('USER_CANCELLED'); return;
                }
            } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
            return; // Stop workflow if mapping errors persist
        }

        // If loop completed without errors and we have lines
        if (qboInvoiceLines.length === 0 && algaInvoiceItems.length > 0) {
             logger.error('Logical error: Item loop finished but no QBO lines generated.', { executionId });
             setState('WORKFLOW_ERROR'); // Should not happen if logic above is correct
             return;
        }

        logger.info(`Successfully mapped ${qboInvoiceLines.length} line items.`, { executionId });

        // --- Prepare QBO Invoice Data ---
        if (!qboCustomerIdToUse) {
            logger.error('Internal Error: qboCustomerIdToUse is missing before QBO API call.', { executionId });
             // Create task for internal error (missing customer ID) - similar structure
             try {
                 const taskResult = await typedActions.create_human_task({
                     taskType: 'internal_workflow_error',
                     title: `System Error: Missing QBO Customer ID - Invoice #${algaInvoice.invoice_number}`,
                     description: `The workflow reached the QBO API call stage for invoice #${algaInvoice.invoice_number}, but the QBO Customer ID was unexpectedly missing. This indicates an internal logic error. Please report to support.`,
                     priority: 'high',
                     assignTo: userId ? { users: [userId] } : undefined,
                     contextData: {
                         message: `Internal Error: qboCustomerIdToUse is missing before QBO API call for invoice #${algaInvoice.invoice_number}.`,
                         alga_invoice_id: algaInvoiceId,
                         alga_company_id: algaCompany.company_id,
                         tenant_id: tenant,
                         realm_id: realmId,
                         workflow_instance_id: executionId
                     }
                 });
                 if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                 const taskId = taskResult.taskId;
                 logger.info(`Task ${taskId} created for missing customer ID error. Waiting...`, { executionId });
                 const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                 const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };
                 if (payload?.userAction === 'fixed') {
                     logger.info(`User fixed missing customer ID issue (Task ${taskId}). Restarting customer check.`, { executionId });
                     setState('CHECKING_CUSTOMER_MAPPING'); // Go back to re-validate customer
                     return; // Restart workflow execution
                 } else {
                     logger.warn(`User cancelled missing customer ID task ${taskId}. Terminating.`, { executionId });
                     setState('USER_CANCELLED'); return;
                 }
             } catch (taskError: any) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
            return;
        }

        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: qboCustomerIdToUse },
            // Add other fields like terms if available
            // SalesTermRef: qboTermId ? { value: qboTermId } : undefined,
        };
        data.set('qboInvoiceData', qboInvoiceData); // Store for potential retry

        // --- QBO API Call Stage ---
        const existingQboInvoiceId = algaInvoice.qbo_invoice_id;
        const qboSyncToken = algaInvoice.qbo_sync_token;
        let qboApiCallSuccessful = false;

        while (!qboApiCallSuccessful) { // Loop for retry
            try {
                let qboResult: { Id: string; SyncToken: string };
                if (existingQboInvoiceId && qboSyncToken) {
                    setState('CALLING_QBO_UPDATE');
                    logger.info('Calling QBO API to update invoice.', { qbo_invoice_id: existingQboInvoiceId, executionId });
                    qboResult = await typedActions.updateQboInvoice({ qboInvoiceData, qboInvoiceId: existingQboInvoiceId, qboSyncToken, tenantId: tenant, realmId, qboCredentials });
                    logger.info('Successfully updated invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });
                } else {
                    setState('CALLING_QBO_CREATE');
                    logger.info('Calling QBO API to create invoice.', { executionId });
                    qboResult = await typedActions.createQboInvoice({ qboInvoiceData, tenantId: tenant, realmId, qboCredentials });
                    logger.info('Successfully created invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });
                }

                // --- Update Alga Stage ---
                setState('UPDATING_ALGA');
                await typedActions.updateInvoiceQboDetails({ invoiceId: algaInvoice.invoice_id, qboInvoiceId: qboResult.Id, qboSyncToken: qboResult.SyncToken, tenantId: tenant });
                logger.info('Successfully updated Alga invoice with QBO IDs.', { invoiceId: algaInvoice.invoice_id, executionId });

                qboApiCallSuccessful = true; // Exit retry loop
                setState('SYNC_COMPLETE');
                logger.info('Workflow completed successfully.', { executionId });

            } catch (error: any) {
                // Handle QBO API Error
                const qboError = error?.response?.data?.Fault?.Error?.[0];
                const errorMessage = qboError?.Message ?? error?.message ?? 'Unknown QBO API error';
                logger.error('QBO API call failed.', { error: errorMessage, details: qboError?.Detail ?? error?.response?.data ?? error, executionId });
                setState('QBO_API_ERROR');

                // Create human task for QBO API error
                try {
                    const taskResult = await typedActions.create_human_task({
                        taskType: 'qbo_sync_error',
                        title: `QuickBooks API Error - Invoice #${algaInvoice.invoice_number}`,
                        description: `Failed to ${existingQboInvoiceId ? 'update' : 'create'} invoice #${algaInvoice.invoice_number} in QuickBooks. Error: ${errorMessage}. Details: ${JSON.stringify(qboError?.Detail ?? error?.response?.data ?? error)}`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `QBO API call failed for invoice #${algaInvoice.invoice_number}. Error: ${errorMessage}.`,
                            alga_invoice_id: algaInvoiceId,
                            qbo_invoice_id: existingQboInvoiceId,
                            error_details: qboError?.Detail ?? error?.response?.data ?? error,
                            tenant_id: tenant,
                            realm_id: realmId,
                            workflow_instance_id: executionId
                        }
                    });
                    if (!taskResult.success || !taskResult.taskId) { /* handle error */ setState('WORKFLOW_ERROR'); return; }
                    const taskId = taskResult.taskId;
                    logger.info(`Task ${taskId} created for QBO API error. Waiting...`, { executionId });

                    const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId));
                    const payload = resolvedEvent.payload as { userAction?: 'fixed' | 'cancel' };

                    if (payload?.userAction === 'fixed') {
                        logger.info(`User fixed QBO API issue (Task ${taskId}). Retrying API call.`, { executionId });
                        // Loop continues, will re-attempt API call
                    } else {
                        logger.warn(`User cancelled QBO API error task ${taskId}. Terminating.`, { executionId });
                        setState('USER_CANCELLED'); return;
                    }
                } catch (taskError: any) {
                    logger.error('Error handling QBO API error human task.', { error: taskError.message, executionId });
                    setState('WORKFLOW_ERROR'); return;
                }
                // If user fixed, the outer while loop will retry the API call.
            }
        } // End while(!qboApiCallSuccessful)

    } catch (workflowError: any) {
        // --- General Workflow Error Handling ---
        logger.error('Unhandled error during workflow execution.', { error: workflowError?.message, stack: workflowError?.stack, executionId });
        setState('WORKFLOW_ERROR');
        const errorInfo = { message: workflowError?.message, stack: workflowError?.stack };
        data.set('workflowError', errorInfo);

        // Create final human task for general error
        try {
            const taskResult = await typedActions.create_human_task({
                taskType: 'workflow_execution_error',
                title: `System Error: QuickBooks Sync Failed - Invoice #${algaInvoiceId ?? 'Unknown'}`,
                description: `The sync workflow for invoice #${algaInvoiceId ?? 'Unknown'} encountered an unexpected error: ${workflowError?.message || 'Unknown error'}. Please check system logs.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `Unhandled error during workflow execution for invoice #${algaInvoiceId ?? 'Unknown'}. Error: ${workflowError?.message || 'Unknown error'}.`,
                    alga_invoice_id: algaInvoiceId,
                    error_details: errorInfo,
                    tenant_id: tenant,
                    realm_id: realmId, // realmId might be null if error happened early
                    workflow_instance_id: executionId
                }
            });
            if (!taskResult.success || !taskResult.taskId) { /* handle error */ logger.error('Failed to create final error task.', { executionId }); }
            else {
                const taskId = taskResult.taskId;
                logger.info(`Final error task ${taskId} created. Waiting...`, { executionId });
                // We might not wait here, just let the workflow end in error state after creating the task.
                // Waiting could lead to infinite loops if fixing the task causes another error.
                // Let's just log and end.
                // const resolvedEvent = await events.waitFor(TaskEventNames.taskCompleted(taskId)); // Optional: wait?
            }
        } catch (taskError: any) {
            logger.error('Error creating final workflow error human task.', { error: taskError.message, executionId });
        }
    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`);
    }
}
