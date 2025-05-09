import { WorkflowContext } from '../../../../shared/workflow/core';

type AlgaInvoice = { invoice_id: string; company_id: string; qbo_invoice_id?: string; qbo_sync_token?: string; };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; };
type AlgaCompany = { company_id: string; qbo_customer_id?: string; qbo_term_id?: string; };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; };
type QboApiError = { message: string; details?: any; statusCode?: number };
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant_id: string; realm_id: string; [key: string]: any; };

interface WorkflowActions {
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>;
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<AlgaInvoiceItem[]>;
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>;
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; found: boolean; qboItemId?: string; message?: string; }>;
    createHumanTask: (args: { taskType: string; formId: string; title: string; details: HumanTaskDetails; assignedUserId?: string | null; tenantId: string; }) => Promise<void>;
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
        mapping?: { externalEntityId: string; [key: string]: any };
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
                 logger.info('Re-fetched company data upon resuming from customer sync wait.', { company_id: potentiallyUpdatedCompany.company_id, hasQboId: !!potentiallyUpdatedCompany.qbo_customer_id, executionId });
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
            logger.info('Fetching required data from Alga PSA.', { executionId });

            const invoice: AlgaInvoice = await typedActions.getInvoice({ id: algaInvoiceId, tenantId: tenant });
            
            logger.info('Inspecting fetched invoice object in workflow:', { invoiceObject: JSON.stringify(invoice, null, 2), executionId });

            if (!invoice?.company_id) {
                 logger.error('Fetched invoice is missing company_id.', { alga_invoice_id: algaInvoiceId, tenant, executionId });
                 setState('DATA_FETCH_ERROR');
                 return;
            }
            
            const invoiceItems: AlgaInvoiceItem[] = await typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant });
            const company: AlgaCompany = await typedActions.getCompany({ id: invoice.company_id, tenantId: tenant });

            if (!invoice || !invoiceItems || !company) {
                logger.error('Failed to fetch required Alga data.', { alga_invoice_id: algaInvoiceId, company_id: invoice?.company_id, executionId });
                setState('DATA_FETCH_ERROR');
                return;
            }

            data.set('algaInvoice', invoice);
            data.set('algaInvoiceItems', invoiceItems);
            data.set('algaCompany', company);
            logger.info('Successfully fetched Alga data.', { executionId });
        }

        const algaInvoice = data.get<AlgaInvoice>('algaInvoice');
        const algaInvoiceItemsResult = data.get<{ success: boolean; items: AlgaInvoiceItem[]; }>('algaInvoiceItems');
        const algaCompany = data.get<AlgaCompany>('algaCompany');
        let qboCustomerIdToUse: string | undefined = algaCompany?.qbo_customer_id;

        if (!algaInvoice || !algaInvoiceItemsResult || !algaCompany) {
             logger.error('Required data not found in workflow context after fetch/resume.', { algaInvoiceId, executionId });
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
                await typedActions.createHumanTask({
                    taskType: 'qbo_customer_mapping_lookup_error',
                    formId: 'qbo-customer-mapping-lookup-error-form',
                    title: `Failed QBO Customer Mapping Lookup for Company ID: ${algaCompany.company_id}`,
                    details: {
                        message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${algaCompany.company_id} in Realm ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the mapping system or action.`,
                        alga_company_id: algaCompany.company_id,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
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
                logger.info('Customer Sync workflow triggered. Pausing Invoice Sync.', { executionId });
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
                await typedActions.createHumanTask({
                    taskType: 'secret_fetch_error',
                    formId: 'secret-fetch-error-form',
                    title: `Failed to Fetch QBO Credentials for Realm ID: ${realmId}`,
                    details: {
                        message: `The workflow failed to retrieve QBO credentials for Realm ID ${realmId}. Error: ${secretResult.message}. Please check the secret configuration.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
                });
                logger.warn('Skipping updateInvoiceQboDetails for SECRET_FETCH_ERROR as sync status is handled elsewhere.', { algaInvoiceId, tenant });
                return;
            }
            qboCredentials = secretResult.secret;
            data.set('qboCredentials', qboCredentials);
            logger.info('Successfully fetched and stored QBO credentials.', { executionId });
        }


        setState('MAPPING_DATA');
        logger.info('Mapping Alga Invoice data to QBO format.', { executionId });

        const qboInvoiceLines: any[] = [];

        const itemsToIterate = (algaInvoiceItemsResult && algaInvoiceItemsResult.success && Array.isArray(algaInvoiceItemsResult.items))
            ? algaInvoiceItemsResult.items
            : [];

        for (const item of itemsToIterate) {
            if (!item.service_id) {
                logger.warn("Invoice line item does not have an associated product ID.", { item_id: item.id, executionId });
                // Log available user IDs before creating human task
                logger.info('User IDs available before creating human task:', {
                    contextUserId: context.userId,
                    inputTriggerEventUserId: context.input?.triggerEvent?.user_id,
                    inputTriggerEventPayloadUserId: context.input?.triggerEvent?.payload?.userId,
                    destructuredUserId: userId,
                    executionId
                });
                
                await typedActions.createHumanTask({
                    taskType: 'qbo_mapping_error',
                    formId: 'qbo-mapping-error-form',
                    title: `Invoice Line Item Missing Product Association`,
                    details: {
                        message: `Cannot sync invoice ${algaInvoice.invoice_id} because line item ${item.id} does not have an associated Alga Product. Please associate a product or handle description-only lines.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_item_id: item.id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
                });
                
                // Log the value that was actually used
                logger.info('User ID passed to createHumanTask:', {
                    assignedUserId: context.userId || null,
                    executionId
                });
                continue;
            }

            const mappingResult = await typedActions.lookupQboItemId({ algaProductId: item.service_id, tenantId: tenant, realmId, qboCredentials });

            if (!mappingResult.success) {
                logger.error('QBO Item lookup action failed.', { alga_service_id: item.service_id, tenant, realmId, error: mappingResult.message, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_lookup_failed',
                    formId: 'qbo-item-lookup-failed-form',
                    title: `QBO Item Lookup Failed for Alga Service ID: ${item.service_id}`,
                    details: {
                        message: `The lookup action for Alga Service ID ${item.service_id} failed for Realm ID ${realmId}. Error: ${mappingResult.message || 'Unknown error'}. Please investigate the lookup action or system.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
                });
                continue;
            }

            if (!mappingResult.found) {
                logger.warn('No QBO Item mapping found for Alga Service ID.', { alga_service_id: item.service_id, tenant, realmId, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_mapping_missing',
                    formId: 'qbo-item-mapping-missing-form',
                    title: `QBO Item Mapping Missing for Alga Service ID: ${item.service_id}`,
                    details: {
                        message: `Cannot sync invoice ${algaInvoice.invoice_id} because Alga Service ID ${item.service_id} is not mapped to a QBO Item for Realm ID ${realmId}. Please map the product in Alga PSA settings.`,
                        alga_invoice_id: algaInvoice.invoice_id,
                        alga_service_id: item.service_id,
                        tenant_id: tenant,
                        realm_id: realmId,
                        workflow_instance_id: executionId,
                    },
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
                });
                continue;
            }

            const qboItemId = mappingResult.qboItemId;
            if (!qboItemId) {
                logger.error('QBO Item lookup succeeded and found=true, but qboItemId is missing.', { alga_service_id: item.service_id, tenant, realmId, mappingResult, executionId });
                await typedActions.createHumanTask({
                    taskType: 'qbo_item_lookup_internal_error',
                    formId: 'qbo-item-lookup-internal-error-form',
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
                    assignedUserId: context.userId || null,
                    tenantId: tenant,
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
             await typedActions.createHumanTask({
                 taskType: 'qbo_invoice_no_items_mapped',
                 formId: 'qbo-invoice-no-items-mapped-form',
                 title: `No QBO Items Mapped for Invoice ID: ${algaInvoice.invoice_id}`,
                 details: {
                     message: `Invoice ${algaInvoice.invoice_id} could not be synced to QBO because none of its line items could be mapped to QBO Items. See other human tasks for specific item mapping issues.`,
                     alga_invoice_id: algaInvoice.invoice_id,
                     tenant_id: tenant,
                     realm_id: realmId,
                     workflow_instance_id: executionId,
                 },
                 assignedUserId: context.userId || null,
                 tenantId: tenant,
             });
             logger.warn('Skipping updateInvoiceQboDetails for MAPPING_ERROR as sync status is handled elsewhere.', { invoiceId: algaInvoice.invoice_id, tenantId: tenant });
             return;
        }

        logger.info(`Successfully mapped ${qboInvoiceLines.length} line items to QBO format.`, { executionId });

        const qboTermId = algaCompany.qbo_term_id;
        if (!qboTermId) {
             logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { company_id: algaCompany.company_id, executionId });
        }


        if (!qboCustomerIdToUse) {
            logger.error('Critical: QBO Customer ID not resolved before mapping QBO invoice data. This indicates an unexpected workflow state.', { company_id: algaCompany!.company_id, invoice_id: algaInvoice!.invoice_id, executionId });
            setState('INTERNAL_ERROR_CUSTOMER_ID_MISSING');
            await typedActions.createHumanTask({
                taskType: 'internal_workflow_error',
                formId: 'internal-workflow-error-form',
                title: `Critical Error: QBO Customer ID Missing for Invoice ${algaInvoice!.invoice_id}`,
                details: {
                    message: `The QBO Invoice Sync workflow reached the data mapping stage for invoice ${algaInvoice!.invoice_id} (Company ID: ${algaCompany!.company_id}) without a resolved QBO Customer ID. This should have been handled by earlier checks. Please investigate workflow logic.`,
                    alga_invoice_id: algaInvoice!.invoice_id,
                    alga_company_id: algaCompany!.company_id,
                    tenant_id: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId,
                },
                assignedUserId: context.userId || null,
                tenantId: tenant,
            });
            logger.warn('Skipping updateInvoiceQboDetails for INTERNAL_ERROR_CUSTOMER_ID_MISSING as sync status is handled elsewhere.', { invoiceId: algaInvoice!.invoice_id, tenantId: tenant });
            return;
        }

        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: qboCustomerIdToUse },
        };
        data.set('qboInvoiceData', qboInvoiceData);
        logger.info('Successfully mapped data to QBO format.', { lineItemCount: qboInvoiceLines.length, executionId });

        const existingQboInvoiceId = algaInvoice.qbo_invoice_id;
        const qboSyncToken = algaInvoice.qbo_sync_token;

        try {
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
            logger.info('Updating Alga PSA invoice with QBO details.', { alga_invoice_id: algaInvoice.invoice_id, qbo_invoice_id: qboResult.Id, executionId });
            await typedActions.updateInvoiceQboDetails({
                invoiceId: algaInvoice.invoice_id,
                qboInvoiceId: qboResult.Id,
                qboSyncToken: qboResult.SyncToken,
                tenantId: tenant
            });
            logger.info('Successfully updated Alga invoice with QBO IDs. Sync status update in mapping table is pending new action.', { invoiceId: algaInvoice.invoice_id });

            setState('SYNC_COMPLETE');
            logger.info('QBO Invoice sync successful.', { alga_invoice_id: algaInvoice.invoice_id, qbo_invoice_id: qboResult.Id, executionId });

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

            await typedActions.createHumanTask({
                taskType: 'qbo_sync_error',
                formId: 'qbo-sync-error-form',
                title: `QBO Invoice Sync Failed for Invoice ID: ${algaInvoice.invoice_id}`,
                details: {
                    message: `Failed to ${existingQboInvoiceId ? 'update' : 'create'} invoice ${algaInvoice.invoice_id} in QBO for Realm ID ${realmId}. Error Code: ${errorCode}`,
                    alga_invoice_id: algaInvoice.invoice_id,
                    qbo_invoice_id_attempted: existingQboInvoiceId,
                    tenant_id: tenant,
                    realm_id: realmId,
                    error: errorDetails,
                    workflow_instance_id: executionId,
                },
                assignedUserId: context.userId || null,
                tenantId: tenant,
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
        const errorInfo = { message: workflowError?.message, stack: workflowError?.stack };
        data.set('workflowError', errorInfo);

         const algaInvoiceIdForError = data.get<AlgaInvoice>('algaInvoice')?.invoice_id ?? triggerEventPayload?.invoiceId;
         if (algaInvoiceIdForError && tenant) {
             try {
                 logger.warn('Skipping updateInvoiceQboDetails for WORKFLOW_ERROR as sync status is handled elsewhere. A separate action should update the mapping table.', { algaInvoiceIdForError, tenantId: tenant });
             } catch (updateError: any) {
                 logger.error('Failed to update Alga invoice status after unhandled workflow error.', { updateError: updateError?.message, executionId });
             }
         }

         await typedActions.createHumanTask({
              taskType: 'workflow_execution_error',
              formId: 'workflow-execution-error-form',
              title: `Workflow Error in QBO Invoice Sync for Invoice: ${algaInvoiceIdForError ?? 'Unknown'}`,
              details: {
                  message: `An unexpected error occurred during the QBO Invoice Sync workflow execution.`,
                  alga_invoice_id: algaInvoiceIdForError ?? 'Unknown',
                  tenant_id: tenant ?? 'Unknown',
                  realm_id: realmId ?? 'Unknown',
                  workflow_instance_id: executionId,
                  error: errorInfo,
              },
              assignedUserId: context.userId || null,
              tenantId: tenant ?? 'Unknown',
          });

    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`);
    }
}