import { WorkflowContext } from '../../../../shared/workflow/core';

type AlgaInvoice = { invoice_id: string; invoice_number: string; company_id: string; qbo_invoice_id?: string; qbo_sync_token?: string; };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; service_name?: string; };
type AlgaCompany = { company_id: string; qbo_customer_id?: string; qbo_term_id?: string; };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; };
type QboApiError = { message: string; details?: any; statusCode?: number };
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant_id: string; realm_id: string;[key: string]: any; };

interface WorkflowActions {
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>;
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<{ success: boolean; items: AlgaInvoiceItem[]; message?: string; error?: any; }>;
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>;
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; found: boolean; qboItemId?: string; message?: string; }>;
    create_human_task: (args: { taskType: string; title: string; description?: string; priority?: string; dueDate?: string; assignTo?: { roles?: string[]; users?: string[] }; contextData?: any; formId?: string; }) => Promise<{ success: boolean; taskId: string }>;
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
    }

    logger.info('Workflow context initialized.', { tenant, realmId, triggerEventName, algaInvoiceId, executionId });

    if (currentState === 'WAITING_FOR_CUSTOMER_SYNC') {
        logger.info('Resuming workflow after customer sync.', { executionId });
        try {
            const potentiallyUpdatedCompany: AlgaCompany = await typedActions.getCompany({ id: data.get<AlgaInvoice>('algaInvoice')?.company_id!, tenantId: tenant });
            if (potentiallyUpdatedCompany) {

                data.set('algaCompany', potentiallyUpdatedCompany);
            } else {
                throw new Error('Failed to re-fetch company data after customer sync wait.');
            }
        } catch (fetchError: any) {
            logger.error('Error re-fetching company data after customer sync wait.', { error: fetchError?.message, executionId });
            setState('DATA_FETCH_ERROR');
            return;
        }
    } else if (currentState !== 'INITIAL' && currentState !== null) {
        logger.info(`Resuming workflow from state: ${currentState}`, { executionId });
    }


    try {
        if (!data.get('algaInvoice') || !data.get('algaInvoiceItems') || !data.get('algaCompany')) {
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
        const algaInvoice = data.get<AlgaInvoice>('algaInvoice');
        const retrievedInvoiceItemsArray = data.get<AlgaInvoiceItem[]>('algaInvoiceItems') || [];
        const algaCompany = data.get<AlgaCompany>('algaCompany');
        let qboCustomerIdToUse: string | undefined = algaCompany?.qbo_customer_id;

        if (!algaInvoice || !retrievedInvoiceItemsArray || !algaCompany) {
            logger.error('Required data not found in workflow context after fetch/resume (invoice, items array, or company).', { algaInvoiceId, executionId });
            setState('INTERNAL_ERROR');
            return;
        }

        const needsCustomerCheck = ['INITIAL', 'FETCHING_DATA', 'WAITING_FOR_CUSTOMER_SYNC'].includes(getCurrentState() ?? 'INITIAL');

        if (needsCustomerCheck) {
            setState('CHECKING_CUSTOMER_MAPPING');
            logger.info('Checking for QBO Customer mapping.', { company_id: algaCompany.company_id, executionId });

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
                        algaCompany.qbo_customer_id = qboCustomerIdToUse;
                    }
                } else {
                    logger.warn('No QBO Customer mapping found via get_external_entity_mapping. Will trigger Customer Sync.', { company_id: algaCompany.company_id, executionId });
                    qboCustomerIdToUse = undefined;
                }
            } else {
                logger.error('Failed to lookup QBO Customer mapping via get_external_entity_mapping.', {
                    company_id: algaCompany.company_id,
                    error: mappingResult.message,
                    executionId
                });
                setState('CUSTOMER_MAPPING_LOOKUP_ERROR');
                await typedActions.create_human_task({
                    taskType: 'qbo_customer_mapping_lookup_error',
                    formId: 'qbo-customer-mapping-lookup-error-form',
                    title: `Failed QuickBooks Customer Mapping Lookup for Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                    description: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}.`,
                    priority: 'high',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the mapping system or action.`,
                        alga_company_id: algaCompany.company_id,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    }
                });

                logger.warn('Skipping updateInvoiceQboDetails for CUSTOMER_MAPPING_LOOKUP_ERROR as no QBO IDs are available and sync status is handled elsewhere.', { algaInvoiceId, tenant });
                return;
            }

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
                return;
            } else {
                logger.info('Proceeding with QBO Customer ID for invoice processing.', { qbo_customer_id: qboCustomerIdToUse, company_id: algaCompany.company_id, executionId });
            }
        }

        let qboCredentials = data.get<any>('qboCredentials');
        if (!qboCredentials) {
            setState('FETCHING_QBO_CREDENTIALS');
            logger.info('Fetching QBO credentials using get_secret action.', { realmId, executionId });
            const secretResult = await typedActions.get_secret({
                secretName: 'qbo_credentials',
                scopeIdentifier: realmId,
                tenantId: tenant,
            });

            if (!secretResult.success || !secretResult.secret) {
                logger.error('Failed to fetch QBO credentials.', {
                    message: secretResult.message,
                    realmId,
                    executionId,
                });
                setState('SECRET_FETCH_ERROR');
                await typedActions.create_human_task({
                    taskType: 'secret_fetch_error',
                    formId: 'secret-fetch-error-form',
                    title: `QuickBooks Authentication Error - Invoice ${algaInvoiceId}`,
                    description: `The system could not retrieve QuickBooks credentials needed to sync invoice ${algaInvoiceId}.`,
                    priority: 'high',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `Could not retrieve QuickBooks authentication credentials for Realm ID ${realmId}. This may indicate that the QuickBooks connection has expired or was never properly set up. Error: ${secretResult.message}. Please check the QuickBooks connection in the integration settings.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                });
                logger.warn('Skipping updateInvoiceQboDetails for SECRET_FETCH_ERROR as sync status is handled elsewhere.', { algaInvoiceId, tenant });
                return;
            }
            qboCredentials = secretResult.secret;
            data.set('qboCredentials', qboCredentials);
        }

        // Transition to mapping data state
        setState('MAPPING_DATA');

        const qboInvoiceLines: any[] = [];

        const itemsToIterate = Array.isArray(retrievedInvoiceItemsArray) ? retrievedInvoiceItemsArray : [];

        for (const item of itemsToIterate) {
            if (!item.service_id) {
                await typedActions.create_human_task({
                    taskType: 'qbo_mapping_error',
                    formId: 'qbo-mapping-error-form',
                    title: `Invoice Line Item Missing Product Association - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                    description: `Cannot sync invoice to QuickBooks because one of the line items (ID: ${item?.id || item?.invoice_id || 'Unknown'}) is missing a product association.`,
                    priority: 'medium',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `Cannot sync invoice ${algaInvoice?.invoice_id || 'Unknown'} to QuickBooks because line item (ID: ${item?.id || 'Unknown'}, Amount: ${item?.amount || 'N/A'}) does not have an associated Alga Product. Please associate a product with this line item or handle description-only lines in the invoice settings.`,
                        alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                        alga_item_id: item?.id || 'Unknown',
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                });

                // Log the value that was actually used
                logger.info('User ID passed to create_human_task:', {
                    userId: context.userId || null,
                    executionId
                });
                continue;
            }

            const mappingResult = await typedActions.lookupQboItemId({ algaProductId: item.service_id, tenantId: tenant, realmId, qboCredentials });

            if (!mappingResult.success) {

                await typedActions.create_human_task({
                    taskType: 'qbo_item_lookup_failed',
                    formId: 'qbo-item-lookup-failed-form',
                    title: `QuickBooks Item Lookup Failed - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                    description: `The system encountered an error looking up QuickBooks item for product ID ${item.service_id || 'Unknown'}.`,
                    priority: 'high',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `Failed to look up QuickBooks item mapping for product ID ${item.service_id || 'Unknown'} in invoice #${algaInvoice?.invoice_number || 'Unknown'}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the QuickBooks integration configuration.`,
                        alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                });
                continue;
            }

            if (!mappingResult.found) {

                await typedActions.create_human_task({
                    taskType: 'qbo_item_mapping_missing',
                    formId: 'qbo-item-mapping-missing-form',
                    title: `Product Not Mapped in QuickBooks - Invoice ${algaInvoice?.invoice_number || 'Unknown Invoice'}`,
                    description: `Cannot sync invoice #${algaInvoice?.invoice_number || 'Unknown'} because product '${item.service_name || 'Unknown Product'}' (ID: ${item.service_id || 'Unknown'}) is not mapped to a QuickBooks item.`,
                    priority: 'medium',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `Cannot sync invoice #${algaInvoice?.invoice_number || 'Unknown'} to QuickBooks because product '${item.service_name || 'Unknown Product'}' (ID: ${item.service_id || 'Unknown'}) is not mapped to a QuickBooks item. Please create this mapping in the QuickBooks integration settings.`,
                        alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                });
                continue;
            }

            const qboItemId = mappingResult.qboItemId;
            if (!qboItemId) {

                await typedActions.create_human_task({
                    taskType: 'qbo_item_lookup_internal_error',
                    formId: 'qbo-item-lookup-internal-error-form',
                    title: `System Error: QuickBooks Item Lookup - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                    description: `The system reported a successful lookup for product ID ${item.service_id || 'Unknown'} but didn't return a QuickBooks item ID.`,
                    priority: 'high',
                    assignTo: context.userId ? { users: [context.userId] } : undefined,
                    contextData: {
                        message: `System error: The QuickBooks item lookup for product ID ${item.service_id || 'Unknown'} in invoice #${algaInvoice?.invoice_number || 'Unknown'} reported success but failed to return a QuickBooks item ID. This indicates a problem with the integration service. Please notify technical support.`,
                        alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                });
                continue;
            }

            qboInvoiceLines.push({
                Amount: item.amount ?? 0,
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: {
                    ItemRef: { value: qboItemId },
                },
            });
        }

        if (qboInvoiceLines.length === 0 && itemsToIterate.length > 0) {
            logger.warn('No line items were successfully mapped to QBO items.', { executionId });
            setState('MAPPING_ERROR');
            await typedActions.create_human_task({
                taskType: 'qbo_invoice_no_items_mapped',
                formId: 'qbo-invoice-no-items-mapped-form',
                title: `No Products Could Be Mapped - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                description: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced because none of its line items could be mapped to QuickBooks items.`,
                priority: 'high',
                assignTo: context.userId ? { users: [context.userId] } : undefined,
                contextData: {
                    message: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced to QuickBooks because none of its line items could be mapped to QuickBooks items. This usually indicates that multiple products need to be mapped in the QuickBooks integration settings. Please check the individual product mapping errors for more details.`,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    tenant_id: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
            });

            return;
        }

        logger.info(`Successfully mapped ${qboInvoiceLines.length} line items to QBO format.`, { executionId });

        const qboTermId = algaCompany.qbo_term_id;
        if (!qboTermId) {
            logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { company_id: algaCompany.company_id, executionId });
        }


        if (!qboCustomerIdToUse) {

            setState('INTERNAL_ERROR_CUSTOMER_ID_MISSING');
            await typedActions.create_human_task({
                taskType: 'internal_workflow_error',
                formId: 'internal-workflow-error-form',
                title: `System Error: Missing Customer - Invoice #${algaInvoice!.invoice_number}`,
                description: `Cannot sync invoice because the system couldn't find a QuickBooks customer for company ID ${algaCompany!.company_id}.`,
                priority: 'high',
                assignTo: context.userId ? { users: [context.userId] } : undefined,
                contextData: {
                    message: `System error: The workflow couldn't find a QuickBooks customer ID for company ${algaCompany!.company_id} when trying to sync invoice #${algaInvoice!.invoice_number}. This indicates either a mapping issue or a system error. Please ensure the company is properly mapped to a QuickBooks customer or contact technical support.`,
                    alga_invoice_id: algaInvoice!.invoice_id,
                    alga_company_id: algaCompany!.company_id,
                    tenant_id: tenant,
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

        try {
            // Verify invoice data before API call
            const invoiceBeforeApiCall = data.get<AlgaInvoice>('algaInvoice');

            let qboResult: { Id: string; SyncToken: string };

            if (existingQboInvoiceId && qboSyncToken) {
                setState('CALLING_QBO_UPDATE');
                logger.info('Calling QBO API to update existing invoice.', { qbo_invoice_id: existingQboInvoiceId, executionId });
                qboResult = await typedActions.updateQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    qboInvoiceId: existingQboInvoiceId,
                    qboSyncToken: qboSyncToken,
                    tenantId: tenant,
                    realmId: realmId,
                    qboCredentials
                });
                logger.info('Successfully updated invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });
            } else {
                setState('CALLING_QBO_CREATE');
                logger.info('Calling QBO API to create new invoice.', { executionId });
                qboResult = await typedActions.createQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    tenantId: tenant,
                    realmId: realmId,
                    qboCredentials
                });
                logger.info('Successfully created invoice in QBO.', { qbo_invoice_id: qboResult.Id, executionId });
            }

            setState('UPDATING_ALGA');

            if (!algaInvoice?.invoice_id) {

                throw new Error('algaInvoice.invoice_id is undefined when trying to update QBO details');
            }

            await typedActions.updateInvoiceQboDetails({
                invoiceId: algaInvoice.invoice_id,
                qboInvoiceId: qboResult.Id,
                qboSyncToken: qboResult.SyncToken,
                tenantId: tenant
            });
            logger.info('Successfully updated Alga invoice with QBO IDs.', {
                invoiceId: algaInvoice?.invoice_id || 'Unknown'
            });

            setState('SYNC_COMPLETE');

        } catch (error: any) {
            const qboError = error?.response?.data?.Fault?.Error?.[0];
            const errorMessage = qboError?.Message ?? error?.message ?? 'Unknown QBO API error';
            const errorCode = qboError?.code ?? error?.response?.status ?? 'UNKNOWN';

            logger.error('QBO API call failed.', {
                error: errorMessage,
                errorCode: errorCode,
                details: qboError?.Detail ?? error?.response?.data ?? error,
                stack: error?.stack,
                executionId
            });
            setState('QBO_API_ERROR');
            const errorDetails = {
                message: errorMessage,
                code: errorCode,
                details: qboError?.Detail ?? error?.response?.data ?? error,
                statusCode: error?.response?.status
            };
            data.set('qboApiError', errorDetails);

            const isRetryable = errorCode === '429' || errorCode >= 500;
            if (isRetryable) {
                logger.warn('Potential retryable error detected. Scheduling retry (logic TBD).', { errorCode, executionId });
            }

            await typedActions.create_human_task({
                taskType: 'qbo_sync_error',
                formId: 'qbo-sync-error-form',
                title: `QuickBooks API Error - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                description: `The system failed to ${existingQboInvoiceId ? 'update the existing' : 'create a new'} invoice in QuickBooks.`,
                priority: 'high',
                assignTo: context.userId ? { users: [context.userId] } : undefined,
                contextData: {
                    message: `QuickBooks API error: Failed to ${existingQboInvoiceId ? 'update' : 'create'} invoice #${algaInvoice?.invoice_number || 'Unknown'} in QuickBooks. This may be due to API permissions, invalid data, or QuickBooks service issues. Error: ${error.message || 'Unknown error'}.`,
                    details: errorDetails,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    tenant_id: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
            });

            if (existingQboInvoiceId) {
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
        }

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
            formId: 'workflow-execution-error-form',
            title: `System Error: QuickBooks Invoice Sync Failed - Invoice #${algaInvoiceIdForError ?? 'Unknown'}`,
            description: `The QuickBooks invoice sync workflow encountered an unexpected error. Technical support may be needed.`,
            priority: 'high',
            assignTo: context.userId ? { users: [context.userId] } : undefined,
            contextData: {
                message: `The QuickBooks invoice sync workflow encountered an unexpected system error while processing invoice #${algaInvoiceIdForError ?? 'Unknown'}. This may indicate a problem with the workflow configuration or the QuickBooks integration service. Please notify technical support with the workflow instance ID.`,
                alga_invoice_id: algaInvoiceIdForError ?? 'Unknown',
                original_trigger_event_invoice_id: triggerEventPayload?.invoiceId ?? 'Unknown',
                tenant_id: tenant ?? 'Unknown',
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