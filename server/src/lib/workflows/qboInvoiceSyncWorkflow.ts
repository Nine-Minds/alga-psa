import { WorkflowContext, CreateTaskAndWaitForResultParams, CreateTaskAndWaitForResultReturn } from '../../../../shared/workflow/core';

type AlgaInvoice = { invoice_id: string; invoice_number: string; company_id: string; qbo_invoice_id?: string; qbo_sync_token?: string; };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; service_name?: string; };
type AlgaCompany = { company_id: string; qbo_customer_id?: string; qbo_term_id?: string; };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; };
type QboApiError = { message: string; details?: any; statusCode?: number };
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant: string; realm_id: string;[key: string]: any; };

interface WorkflowActions extends Record<string, (params: any) => Promise<any>> {
    createTaskAndWaitForResult: (params: CreateTaskAndWaitForResultParams) => Promise<CreateTaskAndWaitForResultReturn>;
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

    // Constants for retry attempts
    const MAX_CUSTOMER_PROCESSING_ATTEMPTS = 3;
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
    }

    logger.info('Workflow context initialized.', { tenant, realmId, triggerEventName, algaInvoiceId, executionId });

    // Removed the old WAITING_FOR_CUSTOMER_SYNC block, as resumption is now handled by awaiting the specific event.
    if (currentState !== 'INITIAL' && currentState !== null && currentState !== 'AWAITING_CUSTOMER_SYNC_COMPLETION') { // Add new await state
        logger.info(`Resuming workflow from state: ${currentState}`, { executionId });
    }


    try {
        // Ensure algaCompany is loaded or fetched if not present or if resuming from a state that might need it refreshed.
        // The main data fetching block will handle initial load.
        // If resuming from AWAITING_CUSTOMER_SYNC_COMPLETION, algaCompany will be updated from event or refetched.
        if (!data.get('algaInvoice') || !data.get('algaInvoiceItems') || (getCurrentState() !== 'AWAITING_CUSTOMER_SYNC_COMPLETION' && !data.get('algaCompany'))) {
            setState('FETCHING_DATA');


            const invoice: AlgaInvoice = await typedActions.getInvoice({ id: algaInvoiceId, tenantId: tenant });

            logger.info('Inspecting fetched invoice object in workflow:', { invoiceObject: JSON.stringify(invoice, null, 2), executionId });

            if (!invoice?.company_id) {
                logger.error('Fetched invoice is missing company_id.', { alga_invoice_id: algaInvoiceId, tenant, executionId });
                setState('DATA_FETCH_ERROR');
                return;
            }

            const invoiceItemsResult = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant });
            const company: AlgaCompany = await typedActions.getCompany({ id: invoice.company_id, tenantId: tenant });

            if (!invoiceItemsResult || !invoiceItemsResult.success) {
                logger.error('Failed to fetch invoice items or action reported failure.', { alga_invoice_id: algaInvoiceId, tenant, result: invoiceItemsResult, executionId });
                setState('DATA_FETCH_ERROR'); // Or a more specific state if needed
                return;
            }

            const actualInvoiceItemsArray = invoiceItemsResult.items;

            if (!invoice || !actualInvoiceItemsArray || !company) {
                logger.error('Failed to fetch required Alga data (invoice, items array, or company).', { alga_invoice_id: algaInvoiceId, company_id: invoice?.company_id, executionId });
                setState('DATA_FETCH_ERROR');
                return;
            }

            // Store data in workflow context
            data.set('algaInvoice', invoice);
            data.set('algaInvoiceItems', actualInvoiceItemsArray);
            data.set('algaCompany', company);
        }

        // Retrieve invoice data from workflow context
        let algaInvoice = data.get<AlgaInvoice>('algaInvoice'); // Use let for potential re-assignment if needed
        let retrievedInvoiceItemsArray = data.get<AlgaInvoiceItem[]>('algaInvoiceItems') || [];
        let algaCompany = data.get<AlgaCompany>('algaCompany');
        // console.log('algaCompany', algaCompany); // Removed console.log
        let qboCustomerIdToUse: string | undefined = algaCompany?.qbo_customer_id;

        if (!algaInvoice || !retrievedInvoiceItemsArray || !algaCompany) {
             // This check might be too early if data is fetched right after this,
             // but good as a safeguard if those variables are used before re-assignment.
            logger.error('Core data (invoice, items, company) missing from context unexpectedly.', { algaInvoiceId, executionId });
            setState('INTERNAL_ERROR_DATA_MISSING');
            return;
        }
        
        // --- Refactored Customer Processing Block ---
        let customerDetailsResolved = false;
        let customerProcessingAttempt = 0;
        let qboCustomerIdForInvoice: string | undefined; // To store the resolved ID for later use

        while (!customerDetailsResolved) {
            // algaCompany is retrieved from data store at the start of the loop or re-fetched.
            // algaInvoice should have been fetched in the 'FETCHING_DATA' block.
            // If algaInvoice or algaInvoice.company_id is missing here, it's a critical issue.
            if (!algaInvoice || !algaInvoice.company_id) {
                logger.error("Critical: AlgaInvoice or its company_id is not available for customer processing loop.", { executionId, attempt: customerProcessingAttempt, hasInvoice: !!algaInvoice });
                setState("FATAL_ERROR_INVOICE_DATA_MISSING_FOR_CUSTOMER_PROCESSING");
                await typedActions.create_human_task({
                    taskType: 'qbo_sync_error',
                    title: `Critical: Invoice Data Missing for Customer Processing (Invoice ID: ${algaInvoiceId})`,
                    description: `The workflow encountered a critical error while processing invoice ${algaInvoiceId}. The invoice data is missing or incomplete. Please investigate the issue.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `Critical error: Invoice data is missing or incomplete for invoice ${algaInvoiceId}. Please investigate.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant,
                        realm_id: realmId!,
                        workflow_instance_id: executionId,
                        userFixedTheProblem: false
                    },
                })
                return; // Terminal workflow failure
            }

            let currentAlgaCompany = data.get<AlgaCompany>('algaCompany');
            if (!currentAlgaCompany || currentAlgaCompany.company_id !== algaInvoice.company_id || customerProcessingAttempt > 1) {
                 logger.info('Fetching/Re-fetching AlgaCompany for customer processing.', { company_id: algaInvoice.company_id, attempt: customerProcessingAttempt, executionId });
                 currentAlgaCompany = await typedActions.getCompany({ id: algaInvoice.company_id, tenantId: tenant });
                 if (currentAlgaCompany) {
                     data.set('algaCompany', currentAlgaCompany);
                 } else {
                    logger.error("Critical: Failed to fetch AlgaCompany.", { company_id: algaInvoice.company_id, executionId });
                    setState("FATAL_ERROR_COMPANY_UNAVAILABLE_FOR_CUSTOMER_PROCESSING");
                    await typedActions.create_human_task({
                        taskType: 'qbo_sync_error',
                        title: `Critical: AlgaCompany Data Missing for Customer Processing (Invoice ID: ${algaInvoiceId})`,
                        description: `The workflow encountered a critical error while processing invoice ${algaInvoiceId}. The AlgaCompany data is missing or incomplete. Please investigate the issue.`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Critical error: AlgaCompany data is missing or incomplete for invoice ${algaInvoiceId}. Please investigate.`,
                            alga_invoice_id: algaInvoiceId,
                            tenant,
                            realm_id: realmId!,
                            workflow_instance_id: executionId,
                            userFixedTheProblem: false
                        },
                    });
                    return; // Terminal workflow failure
                 }
            }
            
            qboCustomerIdForInvoice = currentAlgaCompany.qbo_customer_id; // Initialize with current known ID from the (potentially refreshed) company object

            logger.info(`Processing company ${currentAlgaCompany.company_id}, current QBO Customer ID from company object: ${qboCustomerIdForInvoice || 'None'}.`, { executionId });

            // Part 1: Attempt to get QBO Customer ID from existing mapping
            setState(`CUSTOMER_MAPPING_LOOKUP_ATTEMPT_${customerProcessingAttempt}`);
            logger.info('Checking for QBO Customer mapping.', { company_id: currentAlgaCompany.company_id, executionId });
            const mappingLookupResult = await typedActions.get_external_entity_mapping({
                algaEntityId: currentAlgaCompany.company_id,
                externalSystemName: 'quickbooks_online',
                externalRealmId: realmId!, // realmId is validated at the start of the workflow
                tenantId: tenant,
            });

            if (mappingLookupResult.success) {
                if (mappingLookupResult.found && mappingLookupResult.mapping?.externalEntityId) {
                    qboCustomerIdForInvoice = mappingLookupResult.mapping.externalEntityId;
                    logger.info('QBO Customer ID found/confirmed via get_external_entity_mapping.', { qbo_customer_id: qboCustomerIdForInvoice, company_id: currentAlgaCompany.company_id, executionId });
                    if (currentAlgaCompany.qbo_customer_id !== qboCustomerIdForInvoice) {
                        logger.info('Updating algaCompany.qbo_customer_id with mapped ID.', { old_id: currentAlgaCompany.qbo_customer_id, new_id: qboCustomerIdForInvoice, executionId });
                        currentAlgaCompany.qbo_customer_id = qboCustomerIdForInvoice;
                        data.set('algaCompany', currentAlgaCompany); // Persist updated company
                    }
                    customerDetailsResolved = true;
                    break; // Exit while loop, customer ID is resolved
                } else {
                    logger.warn('No QBO Customer mapping found via get_external_entity_mapping. Will proceed to customer sync.', { company_id: currentAlgaCompany.company_id, executionId });
                    qboCustomerIdForInvoice = undefined; // Ensure it's clear for the next step
                }
            } else { // get_external_entity_mapping action itself failed
                logger.error('get_external_entity_mapping action failed.', { company_id: currentAlgaCompany.company_id, error: mappingLookupResult.message, executionId });
                setState(`CUSTOMER_MAPPING_LOOKUP_ACTION_ERROR_ATTEMPT_${customerProcessingAttempt}`);
                const taskResolution = await typedActions.createTaskAndWaitForResult({
                    taskType: 'qbo_customer_mapping_lookup_error',
                    title: `Resolve Customer Mapping Lookup: Invoice #${algaInvoice?.invoice_number || algaInvoiceId}`,
                    description: `The workflow failed to look up QBO customer mapping for Alga Company ID ${currentAlgaCompany.company_id} in Realm ${realmId}. Error: ${mappingLookupResult.message || 'Unknown error'}. Please investigate and confirm resolution.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${currentAlgaCompany.company_id}. Error: ${mappingLookupResult.message}. Please investigate.`,
                        alga_company_id: currentAlgaCompany.company_id,
                        alga_invoice_id: algaInvoiceId,
                        tenant,
                        realm_id: realmId!,
                        workflow_instance_id: executionId,
                        error_details: mappingLookupResult.message,
                        userFixedTheProblem: false
                    },
                });
                if (taskResolution.success && taskResolution.resolutionData?.userFixedTheProblem) {
                    logger.info('User indicated mapping lookup action issue resolved. Retrying customer processing loop.', { executionId, taskId: taskResolution.taskId });
                    continue; // Retry the while loop
                } else {
                    logger.warn('Customer mapping lookup action error not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolution.taskId, resolution: taskResolution.resolutionData });
                    setState('CUSTOMER_MAPPING_LOOKUP_ERROR_UNRESOLVED');
                    return; // Terminal workflow failure
                }
            }

            // Part 2: If no QBO Customer ID yet (qboCustomerIdForInvoice is undefined), trigger and await qboCustomerSyncWorkflow
            if (!qboCustomerIdForInvoice) {
                logger.warn('QBO Customer ID is not yet resolved. Triggering Customer Sync.', { company_id: currentAlgaCompany.company_id, executionId });
                setState(`TRIGGERING_CUSTOMER_SYNC_ATTEMPT_${customerProcessingAttempt}`);

                const customerSyncSuccessEventName = `QBO_CUSTOMER_SYNC_COMPLETED_FOR_${executionId}_ATTEMPT_${customerProcessingAttempt}`;
                const customerSyncFailureEventName = `QBO_CUSTOMER_SYNC_FAILED_FOR_${executionId}_ATTEMPT_${customerProcessingAttempt}`;

                await typedActions.triggerWorkflow({
                    name: 'qboCustomerSyncWorkflow',
                    input: {
                        triggerEvent: {
                            name: 'CUSTOMER_SYNC_REQUESTED_BY_INVOICE_WORKFLOW',
                            payload: {
                                company_id: currentAlgaCompany.company_id,
                                tenantId: tenant,
                                realmId: realmId!,
                                originatingWorkflowInstanceId: executionId,
                                successEventName: customerSyncSuccessEventName,
                                failureEventName: customerSyncFailureEventName,
                            }
                        },
                    },
                    tenantId: tenant
                });

                setState(`AWAITING_CUSTOMER_SYNC_COMPLETION_ATTEMPT_${customerProcessingAttempt}`);
                logger.info(`Awaiting customer sync completion events: ${customerSyncSuccessEventName} or ${customerSyncFailureEventName}`, { executionId });

                const customerSyncOutcomeEvent = await events.waitFor(
                    [customerSyncSuccessEventName, customerSyncFailureEventName],
                    // { timeoutMilliseconds: 3600000 } // Optional: 1 hour timeout
                );

                if (customerSyncOutcomeEvent.name === customerSyncSuccessEventName) {
                    const { qbo_customer_id: qboIdFromSync, company_id: companyIdFromSyncEvent } = customerSyncOutcomeEvent.payload;
                    logger.info('Customer sync success event received.', { executionId, payload: customerSyncOutcomeEvent.payload });
                    if (qboIdFromSync && currentAlgaCompany.company_id === companyIdFromSyncEvent) {
                        currentAlgaCompany.qbo_customer_id = qboIdFromSync;
                        data.set('algaCompany', currentAlgaCompany); // Persist updated company
                        qboCustomerIdForInvoice = qboIdFromSync; // Update local variable for this scope
                        customerDetailsResolved = true;
                        logger.info('Updated algaCompany in context with QBO Customer ID from sync event.', { qbo_customer_id: qboCustomerIdForInvoice, executionId });
                        break; // Exit while loop, customer ID is resolved
                    } else {
                        logger.error('Customer sync success event payload missing QBO customer ID, or company ID mismatch with current company.', { executionId, payload: customerSyncOutcomeEvent.payload, expectedCompanyId: currentAlgaCompany.company_id });
                        logger.warn('Continuing to next attempt in customer processing loop due to sync payload issue.', { executionId });
                        // Implicitly continue to the next iteration of the while loop
                    }
                } else { // customerSyncFailureEventName
                    logger.error('Customer sync failed as reported by qboCustomerSyncWorkflow.', { executionId, eventPayload: customerSyncOutcomeEvent.payload });
                    setState(`CUSTOMER_SYNC_FAILED_AWAITING_RESOLUTION_ATTEMPT_${customerProcessingAttempt}`);
                    const taskResolution = await typedActions.createTaskAndWaitForResult({
                        taskType: 'qbo_sync_error',
                        title: `Customer Sync Failed for Invoice ${algaInvoice?.invoice_number || algaInvoiceId}`,
                        description: `The customer sync for Company ID ${currentAlgaCompany.company_id} (related to Invoice ${algaInvoice?.invoice_number || algaInvoiceId}) failed. Error: ${customerSyncOutcomeEvent.payload?.error_message || 'Unknown error from customer sync'}. Please resolve the customer sync issue. You can then choose to retry syncing this invoice.`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Customer sync failed for Company ID ${currentAlgaCompany.company_id}. Error: ${customerSyncOutcomeEvent.payload?.error_message}. Resolve and then decide to retry invoice sync.`,
                            alga_invoice_id: algaInvoiceId,
                            alga_company_id: currentAlgaCompany.company_id,
                            realmId: realmId!,
                            tenant,
                            workflow_instance_id: executionId,
                            customer_sync_error: customerSyncOutcomeEvent.payload?.error_message,
                            userFixedTheProblem: false
                        }
                    });
                    if (taskResolution.success && taskResolution.resolutionData?.userFixedTheProblem) {
                        logger.info('User indicated customer sync failure resolved. Retrying customer processing loop.', { executionId, taskId: taskResolution.taskId });
                        // Implicitly continue to the next iteration of the while loop
                    } else {
                        logger.warn('Customer sync failure not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolution.taskId, resolution: taskResolution.resolutionData });
                        setState('CUSTOMER_SYNC_FAILURE_UNRESOLVED');
                        return; // Terminal workflow failure
                    }
                }
            }
            // If loop continues, it means an attempt failed but more retries are available.
             if (!customerDetailsResolved) {
                logger.info(`Customer details not yet resolved. Will proceed.`, { executionId });
            }

        }

        // Ensure algaCompany in data store is the latest version for subsequent steps.
        // The qboCustomerIdForInvoice is now resolved and stored on currentAlgaCompany.qbo_customer_id, which is persisted in data.get('algaCompany').
        algaCompany = data.get<AlgaCompany>('algaCompany')!; // Re-assign local algaCompany to the one from data store.
        qboCustomerIdToUse = algaCompany?.qbo_customer_id; // Assign to qboCustomerIdToUse for subsequent logic
        logger.info(`Customer processing completed. Resolved QBO Customer ID for invoice ${algaInvoiceId}: ${qboCustomerIdToUse}`, { executionId });
        // --- End of Refactored Customer Processing Block ---

        // algaCompany is already up-to-date from the end of the customer processing block.

        // --- Refactored QBO Credentials Fetching Block ---
        let qboCredentials: any;
        let qboCredentialsFetched = false;
        let credentialFetchAttempt = 0;

        while (!qboCredentialsFetched) {
            credentialFetchAttempt++;
            qboCredentials = data.get<any>('qboCredentials');
            if (qboCredentials) {
                logger.info('QBO credentials found in workflow data.', { executionId, attempt: credentialFetchAttempt });
                qboCredentialsFetched = true;
                break; // Exit loop
            }

            setState(`FETCHING_QBO_CREDENTIALS_ATTEMPT_${credentialFetchAttempt}`);
            logger.info(`Fetching QBO credentials using get_secret action, attempt ${credentialFetchAttempt}.`, { realmId, executionId });
            
            const secretResult = await typedActions.get_secret({
                secretName: 'qbo_credentials',
                scopeIdentifier: realmId!, // realmId is validated at the start
                tenantId: tenant,
            });

            if (secretResult.success && secretResult.secret) {
                qboCredentials = secretResult.secret;
                data.set('qboCredentials', qboCredentials);
                qboCredentialsFetched = true;
                logger.info('Successfully fetched and stored QBO credentials.', { executionId, attempt: credentialFetchAttempt });
                break; // Exit loop
            } else {
                logger.error('Failed to fetch QBO credentials.', { message: secretResult.message, realmId, executionId, attempt: credentialFetchAttempt });
                setState(`SECRET_FETCH_ERROR_AWAITING_RESOLUTION_ATTEMPT_${credentialFetchAttempt}`);
                
                const taskResolutionSecretFetch = await typedActions.createTaskAndWaitForResult({
                    taskType: 'secret_fetch_error',
                    title: `Resolve QuickBooks Auth: Invoice ${algaInvoiceId}`,
                    description: `The system could not retrieve QuickBooks credentials for Realm ID ${realmId} to sync invoice ${algaInvoiceId}. Error: ${secretResult.message || 'Unknown error'}. Please check the QuickBooks connection and confirm resolution.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `Could not retrieve QuickBooks authentication credentials for Realm ID ${realmId}. Error: ${secretResult.message || 'Unknown error'}. Please check the QuickBooks connection. If resolved, submit this task.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant,
                        realm_id: realmId!,
                        workflow_instance_id: executionId,
                        error_details: secretResult.message,
                        userFixedTheProblem: false
                    },
                });

                if (taskResolutionSecretFetch.success && taskResolutionSecretFetch.resolutionData?.userFixedTheProblem) {
                    logger.info('Secret fetch error task resolved by user. Retrying credential fetch.', { executionId, taskId: taskResolutionSecretFetch.taskId, attempt: credentialFetchAttempt });
                    data.set('qboCredentials', undefined); // Clear to force re-fetch on next iteration
                    continue; // Retry the while loop
                } else {
                    logger.warn('Secret fetch error task not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolutionSecretFetch.taskId, resolution: taskResolutionSecretFetch.resolutionData, attempt: credentialFetchAttempt });
                    setState('SECRET_FETCH_ERROR_UNRESOLVED');
                    return; // Terminal workflow failure
                }
            }
        }

        if (!qboCredentialsFetched || !qboCredentials) { // Should not be reached if loop logic is correct
            logger.error('Critical: QBO credentials could not be resolved. Halting workflow.', { executionId });
            setState('FATAL_ERROR_QBO_CREDENTIALS_UNRESOLVED');
            // A human task would have been created in the loop if it was a resolvable issue.
            // This path indicates a logic error or unhandled case.
            return; // Terminal workflow failure
        }
        // --- End of Refactored QBO Credentials Fetching Block ---

        setState('MAPPING_DATA');
        const qboInvoiceLines: any[] = [];
        const itemsToIterate = Array.isArray(retrievedInvoiceItemsArray) ? retrievedInvoiceItemsArray : [];
        let allItemsProcessedSuccessfully = true; 

        for (const item of itemsToIterate) {
            let currentItemServiceId = item.service_id; 
            let itemSuccessfullyAddedToLines = false;
            let attempts = 0;
            const MAX_ATTEMPTS = 2; 

            while (!itemSuccessfullyAddedToLines && attempts < MAX_ATTEMPTS) {
                attempts++;
                setState(`PROCESSING_ITEM_${item.id}_ATTEMPT_${attempts}`);
                logger.info(`Processing item ${item.id}, attempt ${attempts}`, { executionId });

                if (!currentItemServiceId) {
                    logger.warn(`Item ${item.id} is missing service_id. Attempt ${attempts}. Creating human task.`, { executionId });
                    setState(`ITEM_${item.id}_MISSING_SERVICE_ID_AWAITING_RESOLUTION`);
                    const taskResMissingServiceId = await typedActions.createTaskAndWaitForResult({
                        taskType: 'qbo_sync_error', 
                        title: `Item Missing Product/Service: Invoice #${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
                        description: `Line item (ID: ${item.id}) on invoice #${algaInvoice?.invoice_number || 'Unknown'} is missing a product/service association. Please associate a product/service with this item or confirm if it should be skipped.`,
                        priority: 'medium',
                        assignTo: context.userId ? { users: [context.userId] } : undefined,
                        contextData: {
                            message: `Line item (ID: ${item.id}, Amount: ${item.amount || 'N/A'}) on invoice ${algaInvoice?.invoice_id || 'Unknown'} does not have an associated Alga Product/Service. Please associate one. If resolved, submit this task indicating the issue is fixed.`,
                            alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                            alga_item_id: item.id,
                            item_description: item.service_name, 
                            tenant: tenant,
                            realm_id: realmId,
                            workflow_instance_id: executionId,
                            userFixedTheProblem: false 
                        },
                    });

                    if (taskResMissingServiceId.success && taskResMissingServiceId.resolutionData?.userFixedTheProblem) {
                        logger.info(`User indicated missing service_id for item ${item.id} was resolved. Re-fetching item data.`, { executionId, taskId: taskResMissingServiceId.taskId });
                        const refreshedItemsResult = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId!, tenantId: tenant });
                        if (refreshedItemsResult.success) {
                            const refreshedItem = refreshedItemsResult.items.find(i => i.id === item.id);
                            if (refreshedItem?.service_id) {
                                item.service_id = refreshedItem.service_id; 
                                currentItemServiceId = refreshedItem.service_id; 
                                logger.info(`Refreshed item ${item.id} and found service_id: ${currentItemServiceId}`, { executionId });
                            } else {
                                logger.warn(`Item ${item.id} still missing service_id after task resolution and item refresh. Attempt ${attempts}.`, { executionId });
                            }
                        } else {
                             logger.warn(`Failed to refresh invoice items after task for item ${item.id}. Attempt ${attempts}.`, { executionId });
                        }
                        if (attempts < MAX_ATTEMPTS && currentItemServiceId) continue; 
                        else if (attempts >= MAX_ATTEMPTS || !currentItemServiceId) {
                            allItemsProcessedSuccessfully = false; 
                            break; 
                        }
                    } else {
                        logger.warn(`Missing service_id for item ${item.id} not resolved or task failed. Skipping item.`, { executionId, taskId: taskResMissingServiceId.taskId });
                        allItemsProcessedSuccessfully = false;
                        break; 
                    }
                }

                if (currentItemServiceId) {
                    try {
                        const mappingResult = await typedActions.lookupQboItemId({ algaProductId: currentItemServiceId, tenantId: tenant, realmId, qboCredentials });

                        if (!mappingResult.success) {
                            logger.error(`QBO Item lookup action failed for service_id ${currentItemServiceId}. Attempt ${attempts}. Creating task.`, { error: mappingResult.message, executionId });
                            setState(`ITEM_${item.id}_LOOKUP_FAILED_AWAITING_RESOLUTION`);
                            const taskResLookupFailed = await typedActions.createTaskAndWaitForResult({
                                taskType: 'qbo_item_lookup_failed',
                                title: `QuickBooks Item Lookup Failed: Invoice #${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
                                description: `Error looking up QuickBooks item for product ID ${currentItemServiceId}. Error: ${mappingResult.message || 'Unknown'}. Please investigate.`,
                                priority: 'high',
                                assignTo: context.userId ? { users: [context.userId] } : undefined,
                                contextData: {
                                    message: `Failed to look up QuickBooks item mapping for product ID ${currentItemServiceId} (Invoice #${algaInvoice?.invoice_number || 'Unknown'}). Error: ${mappingResult.message || 'Unknown error'}. If resolved, submit this task.`,
                                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                                    alga_service_id: currentItemServiceId,
                                    tenant: tenant,
                                    realm_id: realmId,
                                    workflow_instance_id: executionId,
                                    userFixedTheProblem: false
                                },
                            });
                            if (taskResLookupFailed.success && taskResLookupFailed.resolutionData?.userFixedTheProblem) {
                                logger.info(`User indicated QBO item lookup issue for ${currentItemServiceId} resolved. Retrying item.`, { executionId, taskId: taskResLookupFailed.taskId });
                            } else {
                                logger.warn(`QBO item lookup issue for ${currentItemServiceId} not resolved or task failed. Skipping item.`, { executionId, taskId: taskResLookupFailed.taskId, resolution: taskResLookupFailed.resolutionData });
                                allItemsProcessedSuccessfully = false;
                                break; 
                            }
                            continue; 
                        }

                        if (!mappingResult.found) {
                            logger.warn(`QBO Item ID not found for service_id ${currentItemServiceId}. Attempt ${attempts}. Creating task.`, { executionId });
                            setState(`ITEM_${item.id}_NOT_MAPPED_AWAITING_RESOLUTION`);
                            const taskResNotFound = await typedActions.createTaskAndWaitForResult({
                                taskType: 'qbo_mapping_error',
                                title: `Product Not Mapped: Invoice ${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
                                description: `Product '${item.service_name || 'Unknown Product'}' (ID: ${currentItemServiceId}) is not mapped to a QuickBooks item. Please map it.`,
                                priority: 'medium',
                                assignTo: context.userId ? { users: [context.userId] } : undefined,
                                contextData: {
                                    alga_service_id: currentItemServiceId,
                                    service_name: item.service_name || 'Unknown Product',
                                    alga_company_id: algaCompany?.company_id,
                                    company_name: algaCompany?.company_id || 'Unknown Company',
                                    tenant: tenant,
                                    realm_id: realmId,
                                    workflow_instance_id: executionId,
                                    userFixedTheProblem: false
                                },
                            });
                            if (taskResNotFound.success && taskResNotFound.resolutionData?.userFixedTheProblem) {
                                logger.info(`User indicated QBO item mapping for ${currentItemServiceId} resolved. Retrying item.`, { executionId, taskId: taskResNotFound.taskId });
                            } else {
                                logger.warn(`QBO item mapping for ${currentItemServiceId} not resolved or task failed. Skipping item.`, { executionId, taskId: taskResNotFound.taskId, resolution: taskResNotFound.resolutionData });
                                allItemsProcessedSuccessfully = false;
                                break; 
                            }
                            continue; 
                        }

                        const qboItemId = mappingResult.qboItemId;
                        if (!qboItemId) { // This check is after mappingResult.success && mappingResult.found are true
                            logger.error(`QBO Item ID missing after successful lookup for service_id ${currentItemServiceId}. Attempt ${attempts}. Creating task.`, { executionId });
                            setState(`ITEM_${item.id}_LOOKUP_INTERNAL_ERROR_AWAITING_RESOLUTION`);
                            const taskResInternalError = await typedActions.createTaskAndWaitForResult({
                                taskType: 'qbo_item_lookup_internal_error',
                                title: `System Error: QBO Item Lookup - Invoice #${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
                                description: `System error: Lookup for product ID ${currentItemServiceId} succeeded but no QBO Item ID returned. Please contact support.`,
                                priority: 'high',
                                assignTo: context.userId ? { users: [context.userId] } : undefined,
                                contextData: {
                                    message: `System error: QuickBooks item lookup for product ID ${currentItemServiceId} (Invoice #${algaInvoice?.invoice_number || 'Unknown'}) reported success but no QBO item ID. This needs investigation. If issue is understood and resolved, submit task.`,
                                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                                    alga_service_id: currentItemServiceId,
                                    tenant: tenant,
                                    realm_id: realmId,
                                    workflow_instance_id: executionId,
                                    userFixedTheProblem: false
                                },
                            });
                            if (taskResInternalError.success && taskResInternalError.resolutionData?.userFixedTheProblem) {
                                logger.info(`User indicated QBO internal lookup issue for ${currentItemServiceId} resolved. Retrying item.`, { executionId, taskId: taskResInternalError.taskId });
                            } else {
                                logger.warn(`QBO internal lookup issue for ${currentItemServiceId} not resolved or task failed. Skipping item.`, { executionId, taskId: taskResInternalError.taskId, resolution: taskResInternalError.resolutionData });
                                allItemsProcessedSuccessfully = false;
                                break; 
                            }
                            continue; 
                        }

                        qboInvoiceLines.push({
                            Amount: item.amount ?? 0,
                            DetailType: "SalesItemLineDetail",
                            SalesItemLineDetail: { ItemRef: { value: qboItemId } },
                        });
                        itemSuccessfullyAddedToLines = true; 
                        logger.info(`Item ${item.id} (service_id: ${currentItemServiceId}) successfully processed and added to QBO lines.`, { executionId });

                    } catch (itemError: any) {
                        logger.error(`Unhandled error during mapping for item ${item.id} (service_id: ${currentItemServiceId}) on attempt ${attempts}.`, { error: itemError.message, executionId });
                        if (attempts >= MAX_ATTEMPTS) {
                            logger.error(`Max attempts reached for item ${item.id}. Skipping item.`, { executionId });
                            allItemsProcessedSuccessfully = false;
                            await typedActions.create_human_task({ 
                                taskType: 'qbo_mapping_error',
                                title: `Unrecoverable Mapping Error - Item ${item.id} on Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                                contextData: { message: `Item ${item.id} could not be mapped after ${MAX_ATTEMPTS} attempts. Error: ${itemError.message}. Manual intervention required.`, alga_item_id: item.id, alga_invoice_id: algaInvoice?.invoice_id },
                            });
                            itemSuccessfullyAddedToLines = true; // Mark as processed to exit the while loop
                        }
                    }
                } else {
                     if (attempts >= MAX_ATTEMPTS) { 
                        logger.error(`Item ${item.id} has no service_id after ${MAX_ATTEMPTS} attempts. Skipping.`, {executionId});
                        allItemsProcessedSuccessfully = false;
                     }
                     break; 
                }
            } 

            if (!itemSuccessfullyAddedToLines) {
                logger.warn(`Failed to process item ${item.id} after all attempts. It will not be included in the QBO invoice.`, { executionId });
            }
        } 


        if (qboInvoiceLines.length === 0 && itemsToIterate.length > 0) {
            logger.warn('No line items were successfully mapped to QBO items.', { executionId });
            setState('MAPPING_ERROR');
            await typedActions.create_human_task({
                taskType: 'qbo_invoice_no_items_mapped',
                title: `No Products Could Be Mapped - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                description: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced because none of its line items could be mapped to QuickBooks items.`,
                priority: 'high',
                assignTo: context.userId ? { users: [context.userId] } : undefined,
                contextData: {
                    message: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced to QuickBooks because none of its line items could be mapped to QuickBooks items. This usually indicates that multiple products need to be mapped in the QuickBooks integration settings. Please check the individual product mapping errors for more details.`,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    tenant: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
            });
            return;
        } else if (!allItemsProcessedSuccessfully && qboInvoiceLines.length > 0) {
            logger.warn(`Some line items failed to map for invoice #${algaInvoice?.invoice_number || 'Unknown'}. Proceeding with successfully mapped items. A task will be created.`, { executionId });
            await typedActions.create_human_task({
                 taskType: 'qbo_mapping_error',
                 title: `Partial Item Mapping - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                 description: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} was synced to QuickBooks, but some line items could not be mapped and were excluded. Please review.`,
                 priority: 'medium',
                 assignTo: context.userId ? { users: [context.userId] } : undefined,
                 contextData: {
                    message: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} was synced to QuickBooks, but one or more line items could not be mapped after attempts and were excluded. Please review the individual item mapping errors for details. The invoice in QuickBooks may be incomplete.`,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    successfully_mapped_items_count: qboInvoiceLines.length,
                    total_items_attempted: itemsToIterate.length,
                    tenant: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
            });
        }


        logger.info(`Successfully prepared ${qboInvoiceLines.length} line items for QBO invoice.`, { executionId });

        const qboTermId = algaCompany.qbo_term_id;
        if (!qboTermId) {
            logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { company_id: algaCompany.company_id, executionId });
        }


        if (!qboCustomerIdToUse) {

            setState('INTERNAL_ERROR_CUSTOMER_ID_MISSING');
            await typedActions.create_human_task({
                taskType: 'internal_workflow_error',
                title: `System Error: Missing Customer - Invoice #${algaInvoice!.invoice_number}`,
                description: `Cannot sync invoice because the system couldn't find a QuickBooks customer for company ID ${algaCompany!.company_id}.`,
                priority: 'high',
                assignTo: context.userId ? { users: [context.userId] } : undefined,
                contextData: {
                    message: `System error: The workflow couldn't find a QuickBooks customer ID for company ${algaCompany!.company_id} when trying to sync invoice #${algaInvoice!.invoice_number}. This indicates either a mapping issue or a system error. Please ensure the company is properly mapped to a QuickBooks customer or contact technical support.`,
                    alga_invoice_id: algaInvoice!.invoice_id,
                    alga_company_id: algaCompany!.company_id,
                    tenant: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
            });
            logger.warn('Skipping updateInvoiceQboDetails for INTERNAL_ERROR_CUSTOMER_ID_MISSING as sync status is handled elsewhere.', { invoiceId: algaInvoice!.invoice_id, tenantId: tenant });
            return;
        }

        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: qboCustomerIdToUse },
        };
        data.set('qboInvoiceData', qboInvoiceData);

        const existingQboInvoiceId = algaInvoice?.qbo_invoice_id;
        const qboSyncToken = algaInvoice?.qbo_sync_token;

        // --- Refactored QBO API Call (Create/Update Invoice) Block ---
        let qboApiCallSuccessful = false;
        let qboApiAttempt = 0;

        while (!qboApiCallSuccessful) {
            qboApiAttempt++;
            // Retrieve the latest algaInvoice data for qbo_invoice_id and qbo_sync_token for this attempt
            // This is important if a previous attempt failed and a task might have altered these.
            // However, typically, these are only set upon successful QBO interaction.
            // For simplicity, we'll use the initially fetched algaInvoice details for existingQboInvoiceId/qboSyncToken,
            // as these are usually fixed until a successful QBO sync.
            // If a more complex scenario arises where these can change mid-retry loop, this might need adjustment.
            const currentAlgaInvoiceForApiCall = data.get<AlgaInvoice>('algaInvoice')!; // Should be valid

            try {
                let qboResult: { Id: string; SyncToken: string };

                if (currentAlgaInvoiceForApiCall.qbo_invoice_id && currentAlgaInvoiceForApiCall.qbo_sync_token) {
                    setState(`CALLING_QBO_UPDATE_ATTEMPT_${qboApiAttempt}`);
                    logger.info(`Calling QBO API to update existing invoice, attempt ${qboApiAttempt}.`, { qbo_invoice_id: currentAlgaInvoiceForApiCall.qbo_invoice_id, executionId });
                    qboResult = await typedActions.updateQboInvoice({
                        qboInvoiceData: qboInvoiceData, // This is prepared before the loop
                        qboInvoiceId: currentAlgaInvoiceForApiCall.qbo_invoice_id,
                        qboSyncToken: currentAlgaInvoiceForApiCall.qbo_sync_token,
                        tenantId: tenant,
                        realmId: realmId!,
                        qboCredentials
                    });
                    logger.info('Successfully updated invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId, attempt: qboApiAttempt });
                } else {
                    setState(`CALLING_QBO_CREATE_ATTEMPT_${qboApiAttempt}`);
                    logger.info(`Calling QBO API to create new invoice, attempt ${qboApiAttempt}.`, { executionId });
                    qboResult = await typedActions.createQboInvoice({
                        qboInvoiceData: qboInvoiceData, // Prepared before the loop
                        tenantId: tenant,
                        realmId: realmId!,
                        qboCredentials
                    });
                    logger.info('Successfully created invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId, attempt: qboApiAttempt });
                }

                setState('UPDATING_ALGA_WITH_QBO_DETAILS');
                if (!currentAlgaInvoiceForApiCall.invoice_id) { // Should always be present
                    throw new Error('Critical: currentAlgaInvoiceForApiCall.invoice_id is undefined when trying to update Alga with QBO details');
                }
                await typedActions.updateInvoiceQboDetails({
                    invoiceId: currentAlgaInvoiceForApiCall.invoice_id,
                    qboInvoiceId: qboResult.Id,
                    qboSyncToken: qboResult.SyncToken,
                    tenantId: tenant
                });
                logger.info('Successfully updated Alga invoice with QBO IDs.', { invoiceId: currentAlgaInvoiceForApiCall.invoice_id, qboInvoiceId: qboResult.Id, executionId });
                
                qboApiCallSuccessful = true; // Mark as successful to exit loop
                setState('SYNC_COMPLETE');
                // No break needed here as qboApiCallSuccessful will terminate the loop

            } catch (error: any) {
                const qboError = error?.response?.data?.Fault?.Error?.[0];
                const errorMessage = qboError?.Message ?? error?.message ?? 'Unknown QBO API error';
                const errorCode = qboError?.code ?? error?.response?.status ?? 'UNKNOWN_STATUS_CODE';

                logger.error('QBO API call failed.', { error: errorMessage, errorCode, details: qboError?.Detail ?? error?.response?.data, stack: error?.stack, executionId, attempt: qboApiAttempt });
                setState(`QBO_API_ERROR_AWAITING_RESOLUTION_ATTEMPT_${qboApiAttempt}`);
                
                const errorDetailsForTask = {
                    message: errorMessage,
                    code: errorCode,
                    details: qboError?.Detail ?? JSON.stringify(error?.response?.data, null, 2) ?? JSON.stringify(error, null, 2), // Ensure serializable details
                    statusCode: error?.response?.status
                };
                data.set('qboApiError', errorDetailsForTask); // Store the most recent error

                // For QBO API errors, we typically create a task and then terminate.
                // Retrying QBO API calls without user intervention for data/config issues is often not fruitful.
                // If it's a transient network/service issue (e.g., 5xx), a simple retry might be an option,
                // but the current pattern is to create a human task.
                
                const taskResolutionQboApi = await typedActions.createTaskAndWaitForResult({
                    taskType: 'qbo_sync_error', // General QBO sync error
                    title: `QuickBooks API Error - Invoice #${currentAlgaInvoiceForApiCall.invoice_number || algaInvoiceId}`,
                    description: `The system failed to ${currentAlgaInvoiceForApiCall.qbo_invoice_id ? 'update the existing' : 'create a new'} invoice in QuickBooks. Error: ${errorMessage}. Please investigate and confirm resolution.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `QuickBooks API error: Failed to ${currentAlgaInvoiceForApiCall.qbo_invoice_id ? 'update' : 'create'} invoice #${currentAlgaInvoiceForApiCall.invoice_number || algaInvoiceId}. Error: ${errorMessage}.`,
                        details: errorDetailsForTask,
                        alga_invoice_id: currentAlgaInvoiceForApiCall.invoice_id,
                        tenant,
                        realm_id: realmId!,
                        workflow_instance_id: executionId,
                        userFixedTheProblem: false // User will set this on the task form
                    },
                });

                if (taskResolutionQboApi.success && taskResolutionQboApi.resolutionData?.userFixedTheProblem) {
                    logger.info('User indicated QBO API error resolved. Retrying QBO API call.', { executionId, taskId: taskResolutionQboApi.taskId, attempt: qboApiAttempt });
                    // Potentially clear 'qboApiError' from data store if needed
                    // data.set('qboApiError', undefined); 
                    continue; // Retry the while loop for QBO API call
                } else {
                    logger.warn('QBO API error task not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolutionQboApi.taskId, resolution: taskResolutionQboApi.resolutionData, attempt: qboApiAttempt });
                    setState('QBO_API_ERROR_UNRESOLVED');
                    // If the original invoice had QBO IDs, we might want to ensure they are still on the Alga record
                    // if the update failed. The current logic below handles this.
                    if (currentAlgaInvoiceForApiCall.qbo_invoice_id && currentAlgaInvoiceForApiCall.qbo_sync_token) {
                        // This ensures that if an UPDATE fails, we don't lose the original QBO IDs from Alga.
                        // However, updateInvoiceQboDetails might not be the right action if we just want to confirm existing values.
                        // For now, this matches the previous logic of "retaining" by re-updating with old values.
                        // A better approach might be to only call updateInvoiceQboDetails on SUCCESS.
                        // Given the loop, if it fails and user doesn't fix, we exit.
                        // If they fix and we retry, it's a fresh attempt.
                        // This block might be redundant if the task resolution doesn't lead to a retry.
                        logger.info('Original QBO IDs were present. No change to Alga record after failed QBO update attempt that was not resolved by user.', { algaInvoiceId: currentAlgaInvoiceForApiCall.invoice_id });
                    }
                    return; // Terminal workflow failure
                }
            }
        } // End of while(!qboApiCallSuccessful)

        if (!qboApiCallSuccessful) { // Should only be reached if loop exits due to max attempts (if implemented) or logic error
            logger.error('Critical: QBO API call was not successful after loop. Halting workflow.', { executionId });
            setState('FATAL_ERROR_QBO_API_CALL_UNRESOLVED');
            return; // Terminal workflow failure
        }
        // --- End of Refactored QBO API Call Block ---

    } catch (workflowError: any) {
        logger.error('Unhandled error during QBO Invoice Sync workflow execution.', { error: workflowError?.message, stack: workflowError?.stack, executionId });
        setState('WORKFLOW_ERROR');

        // Deep integrity check on workflow error
        const invoiceOnError = data.get<AlgaInvoice>('algaInvoice');

        const errorInfo = { message: workflowError?.message, stack: workflowError?.stack };
        data.set('workflowError', errorInfo);

        // Try multiple sources to get a valid invoice ID
        let algaInvoiceIdForError: string | undefined;

        // First try data store
        const dataStoreInvoice = data.get<AlgaInvoice>('algaInvoice');
        if (dataStoreInvoice?.invoice_id) {
            algaInvoiceIdForError = dataStoreInvoice.invoice_id;
        }
        // Then try trigger event payload
        else if (triggerEventPayload?.invoiceId) {
            algaInvoiceIdForError = triggerEventPayload.invoiceId;
        }



        // Create human task with as much information as possible about the error
        await typedActions.create_human_task({
            taskType: 'workflow_execution_error',
            title: `System Error: QuickBooks Invoice Sync Failed - Invoice #${algaInvoiceIdForError ?? 'Unknown'}`,
            description: `The QuickBooks invoice sync workflow encountered an unexpected error. Technical support may be needed.`,
            priority: 'high',
            assignTo: context.userId ? { users: [context.userId] } : undefined,
            contextData: {
                message: `The QuickBooks invoice sync workflow encountered an unexpected system error while processing invoice #${algaInvoiceIdForError ?? 'Unknown'}. This may indicate a problem with the workflow configuration or the QuickBooks integration service. Please notify technical support with the workflow instance ID.`,
                alga_invoice_id: algaInvoiceIdForError ?? 'Unknown',
                original_trigger_event_invoice_id: triggerEventPayload?.invoiceId ?? 'Unknown',
                tenant: tenant ?? 'Unknown',
                realm_id: realmId ?? 'Unknown',
                workflow_instance_id: executionId,
                error: errorInfo,
                workflow_state: getCurrentState() ?? 'Unknown',
            },
        });

    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`);
    }
}
