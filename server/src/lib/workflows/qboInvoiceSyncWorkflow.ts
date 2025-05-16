import { error } from 'console';
import { WorkflowContext, CreateTaskAndWaitForResultParams, CreateTaskAndWaitForResultReturn } from '../../../../shared/workflow/core';

// Define WorkflowState as a const to ensure it's available
const WorkflowState = {
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED'
};

type AlgaInvoice = { invoice_id: string; invoice_number: string; company_id: string; };
type AlgaInvoiceItem = { id: string; invoice_id: string; service_id?: string; amount?: number; service_name?: string; };
type AlgaCompany = { company_id: string; qbo_customer_id?: string; qbo_term_id?: string; };
type QboInvoiceData = { Line: any[]; CustomerRef: { value: string }; DocNumber: string; };
type QboMappingInfo = { externalEntityId: string; metadata?: { syncToken?: string; }; };

type TriggerEventPayload = { invoiceId: string; realmId?: string; tenantId?: string; eventName?: string; };
type QboApiError = { message: string; details?: any; statusCode?: number; code?: string };
type HumanTaskDetails = { message: string; alga_invoice_id: string; tenant: string; realm_id: string;[key: string]: any; };
type TaskResolutionResult = { success: boolean; userFixedTheProblem: boolean; taskId: string | null; resolutionData?: any; };

/**
 * Interface for workflow actions used by this workflow
 */
interface WorkflowActions extends Record<string, (params: any) => Promise<any>> {
    createTaskAndWaitForResult: (params: CreateTaskAndWaitForResultParams) => Promise<CreateTaskAndWaitForResultReturn>;
    getInvoice: (args: { id: string; tenantId: string }) => Promise<AlgaInvoice>;
    getInvoiceItems: (args: { invoiceId: string; tenantId: string }) => Promise<{ success: boolean; items: AlgaInvoiceItem[]; message?: string; error?: any; }>;
    getCompany: (args: { id: string; tenantId: string }) => Promise<AlgaCompany>;
    lookupQboItemId: (args: { algaProductId: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; found: boolean; qboItemId?: string; message?: string; }>;
    create_human_task: (args: { taskType: string; title: string; description?: string; priority?: string; dueDate?: string; assignTo?: { roles?: string[]; users?: string[] }; contextData?: any; }) => Promise<{ success: boolean; taskId: string }>;
    triggerWorkflow: (args: { name: string; input: any; tenantId: string; }) => Promise<void>;
    updateQboInvoice: (args: { qboInvoiceData: QboInvoiceData; qboSyncToken: string; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; qboResponse: any; Id?: string; SyncToken?: string; message?: string }>;
    createQboInvoice: (args: { qboInvoiceData: QboInvoiceData; tenantId: string; realmId: string, qboCredentials: any }) => Promise<{ success: boolean; qboResponse: any; Id?: string; SyncToken?: string; message?: string }>;
    // Kept for backward compatibility - we're now using create_or_update_external_entity_mapping
    updateInvoiceQboDetails: (args: { invoiceId: string; qboInvoiceId?: string | null; qboSyncToken?: string | null; tenantId: string }) => Promise<void>;
    get_secret: (args: { secretName: string; scopeIdentifier: string; tenantId: string; }) => Promise<{ success: boolean; secret?: any; message?: string }>;
    get_external_entity_mapping: (args: {
        algaEntityId: string;
        externalSystemName: 'quickbooks_online';
        externalRealmId: string;
        algaEntityType?: string; // Optional parameter, defaults to 'company' if not specified
        tenantId: string;
    }) => Promise<{
        success: boolean;
        found: boolean;
        mapping?: { externalEntityId: string;[key: string]: any };
        message?: string;
    }>;
    create_or_update_external_entity_mapping: (args: {
        algaEntityType: string;
        algaEntityId: string;
        externalSystemName: string;
        externalEntityId: string;
        externalRealmId: string;
        metadata?: any;
        tenantId: string;
    }) => Promise<{
        success: boolean;
        id?: string;
        message?: string;
    }>;
}

/**
 * Common workflow context elements needed for helpers
 */
interface WorkflowHelperContext {
    actions: WorkflowActions;
    logger: WorkflowLogger;
    setState: (state: typeof WorkflowState[keyof typeof WorkflowState] | string) => void;
    tenant: string;
    executionId: string;
    userId?: string;
    data: any;
}

/**
 * Helper interface for workflow logger
 */
interface WorkflowLogger {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
}

/**
 * Workflow to synchronize an Alga PSA Invoice with QuickBooks Online.
 * Triggered by INVOICE_CREATED or INVOICE_UPDATED events.
 */
export async function qboInvoiceSyncWorkflow(context: WorkflowContext): Promise<void> {
    const { actions, data, events, logger, input, setState, getCurrentState, tenant, executionId, userId } = context;
    const typedActions = actions as WorkflowActions;

    // Define all helper functions inside the main workflow function
    // This ensures they're included in the serialized function

    /**
     * Helper to extract QBO API error details consistently
     */
    function formatQboApiError(error: any): QboApiError {
        const qboError = error?.response?.data?.Fault?.Error?.[0];
        return {
            message: qboError?.Message ?? error?.message ?? 'Unknown QBO API error',
            code: qboError?.code ?? error?.response?.status ?? 'UNKNOWN_STATUS_CODE',
            details: qboError?.Detail ?? error?.response?.data ?? error,
            statusCode: error?.response?.status
        };
    }

    /**
     * Helper to create and wait for a human task with consistent error handling
     */
    async function createAndWaitForHumanTask(
        actions: WorkflowActions,
        {
            taskType,
            title,
            description,
            priority = 'medium',
            userId,
            contextData
        }: {
            taskType: 'workflow_error' | 'qbo_mapping_error';
            title: string;
            description: string;
            priority?: string;
            userId?: string;
            contextData: Record<string, any>;
        }
    ): Promise<TaskResolutionResult> {
        const taskResult = await actions.createTaskAndWaitForResult({
            taskType,
            title,
            description,
            priority,
            assignTo: userId ? { users: [userId] } : undefined,
            contextData
        });

        return {
            success: taskResult.success,
            taskId: taskResult.taskId,
            resolutionData: taskResult.resolutionData,
            userFixedTheProblem: !!(taskResult.success && taskResult.resolutionData?.userFixedTheProblem)
        };
    }

    /**
     * Helper to create a human task for QBO credentials error
     */
    async function handleQboCredentialsError(
        ctx: WorkflowHelperContext,
        {
            realmId,
            algaInvoiceId,
            errorMessage
        }: {
            realmId: string;
            algaInvoiceId: string;
            errorMessage?: string;
        }
    ): Promise<TaskResolutionResult> {
        ctx.logger.error('Failed to fetch QBO credentials.', { message: errorMessage, realmId, executionId: ctx.executionId });
        ctx.setState(WorkflowState.ERROR);
        
        return await createAndWaitForHumanTask(ctx.actions, {
            taskType: 'workflow_error',
            title: `Resolve QuickBooks Auth: Invoice ${algaInvoiceId}`,
            description: `The system could not retrieve QuickBooks credentials for Realm ID ${realmId} to sync invoice ${algaInvoiceId}. Error: ${errorMessage || 'Unknown error'}. Please check the QuickBooks connection and confirm resolution.`,
            priority: 'high',
            userId: ctx.userId,
            contextData: {
                message: `Could not retrieve QuickBooks authentication credentials for Realm ID ${realmId}. Error: ${errorMessage || 'Unknown error'}. Please check the QuickBooks connection. If resolved, submit this task.`,
                alga_invoice_id: algaInvoiceId,
                tenant: ctx.tenant,
                realm_id: realmId,
                workflow_instance_id: ctx.executionId
            }
        });
    }

    /**
     * Helper to fetch and validate QBO credentials
     */
    async function fetchQboCredentials(
        ctx: WorkflowHelperContext, 
        realmId: string,
        algaInvoiceId: string
    ): Promise<{ success: boolean; credentials?: any }> {
        // Check for cached credentials
        const cachedCredentials = ctx.data.get('qboCredentials');
        if (cachedCredentials) {
            ctx.logger.info('QBO credentials found in workflow data.', { executionId: ctx.executionId });
            return { success: true, credentials: cachedCredentials };
        }

        // Fetch credentials
        ctx.setState(WorkflowState.RUNNING);
        ctx.logger.info(`Fetching QBO credentials using get_secret action.`, { realmId, executionId: ctx.executionId });
        
        const secretResult = await ctx.actions.get_secret({
            secretName: 'qbo_credentials',
            scopeIdentifier: realmId,
            tenantId: ctx.tenant,
        });

        if (secretResult.success && secretResult.secret) {
            const credentials = secretResult.secret;
            ctx.data.set('qboCredentials', credentials);
            ctx.logger.info('Successfully fetched and stored QBO credentials.', { executionId: ctx.executionId });
            return { success: true, credentials };
        }
        
        // Handle error with task
        const taskResult = await handleQboCredentialsError(ctx, {
            realmId,
            algaInvoiceId,
            errorMessage: secretResult.message
        });
        
        if (taskResult.userFixedTheProblem) {
            // Try fetching the credentials again
            const retrySecretResult = await ctx.actions.get_secret({
                secretName: 'qbo_credentials',
                scopeIdentifier: realmId,
                tenantId: ctx.tenant,
            });
            
            if (retrySecretResult.success && retrySecretResult.secret) {
                const credentials = retrySecretResult.secret;
                ctx.data.set('qboCredentials', credentials);
                ctx.logger.info('Successfully fetched and stored QBO credentials after user resolution.', { executionId: ctx.executionId });
                return { success: true, credentials };
            }
        }
        
        // If we get here, either the user didn't fix the problem or the retry failed
        return { success: false };
    }

    /**
     * Helper to handle QBO customer mapping errors
     */
    async function handleQboCustomerMappingError(
        ctx: WorkflowHelperContext,
        {
            companyId,
            realmId,
            algaInvoiceId,
            invoiceNumber,
            errorMessage
        }: {
            companyId: string;
            realmId: string;
            algaInvoiceId: string;
            invoiceNumber?: string;
            errorMessage?: string;
        }
    ): Promise<TaskResolutionResult> {
        ctx.logger.error('get_external_entity_mapping action failed.', { company_id: companyId, error: errorMessage, executionId: ctx.executionId });
        ctx.setState(WorkflowState.ERROR);
        
        return await createAndWaitForHumanTask(ctx.actions, {
            taskType: 'workflow_error',
            title: `Resolve Customer Mapping Lookup: Invoice #${invoiceNumber || algaInvoiceId}`,
            description: `The workflow failed to look up QBO customer mapping for Alga Company ID ${companyId} in Realm ${realmId}. Error: ${errorMessage || 'Unknown error'}. Please investigate and confirm resolution.`,
            priority: 'high',
            userId: ctx.userId,
            contextData: {
                message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${companyId}. Error: ${errorMessage}. Please investigate.`,
                alga_invoice_id: algaInvoiceId,
                company_id: companyId,
                tenant: ctx.tenant,
                realm_id: realmId,
                workflow_instance_id: ctx.executionId
            }
        });
    }

    /**
     * Helper to handle missing QBO item mapping errors
     */
    async function handleQboItemMappingError(
        ctx: WorkflowHelperContext,
        {
            serviceId,
            serviceName,
            itemId,
            algaInvoiceId,
            invoiceNumber,
            companyId,
            realmId
        }: {
            serviceId: string;
            serviceName?: string;
            itemId: string;
            algaInvoiceId: string;
            invoiceNumber?: string;
            companyId?: string;
            realmId: string;
        }
    ): Promise<TaskResolutionResult> {
        ctx.logger.warn(`QBO Item ID not found for service_id ${serviceId}.`, { executionId: ctx.executionId });
        ctx.setState(WorkflowState.ERROR);
        
        return await createAndWaitForHumanTask(ctx.actions, {
            taskType: 'qbo_mapping_error',
            title: `Product Not Mapped: Invoice ${invoiceNumber || 'Unknown'} (Item ID: ${itemId})`,
            description: `Product '${serviceName || 'Unknown Product'}' (ID: ${serviceId}) is not mapped to a QuickBooks item. Please map it.`,
            priority: 'medium',
            userId: ctx.userId,
            contextData: {
                alga_service_id: serviceId,
                service_name: serviceName || 'Unknown Product',
                alga_company_id: companyId,
                company_name: companyId || 'Unknown Company',
                alga_invoice_id: algaInvoiceId,
                tenant: ctx.tenant,
                realm_id: realmId,
                workflow_instance_id: ctx.executionId,
                userFixedTheProblem: false
            }
        });
    }

    /**
     * Helper to handle QBO API errors
     */
    async function handleQboApiError(
        ctx: WorkflowHelperContext,
        {
            error,
            operation,
            algaInvoiceId,
            invoiceNumber,
            entityId,
            realmId
        }: {
            error: any;
            operation: string;
            algaInvoiceId: string;
            invoiceNumber?: string;
            entityId?: string;
            realmId: string;
        }
    ): Promise<TaskResolutionResult> {
        const qboError = formatQboApiError(error);
        
        ctx.logger.error(`QBO API ${operation} failed.`, { 
            error: qboError.message, 
            errorCode: qboError.code, 
            details: qboError.details, 
            entityId,
            executionId: ctx.executionId 
        });
        
        ctx.setState(WorkflowState.ERROR);
        ctx.data.set('qboApiError', qboError);
        
        return await createAndWaitForHumanTask(ctx.actions, {
            taskType: 'workflow_error',
            title: `QuickBooks API Error - Invoice #${invoiceNumber || algaInvoiceId}`,
            description: `The system failed to ${operation} in QuickBooks. Error: ${qboError.message}. Please investigate and confirm resolution.`,
            priority: 'high',
            userId: ctx.userId,
            contextData: {
                message: `QuickBooks API error: Failed to ${operation} invoice #${invoiceNumber || algaInvoiceId}. Error: ${qboError.message}.`,
                alga_invoice_id: algaInvoiceId,
                error_code: qboError.code,
                error_details: qboError.details,
                tenant: ctx.tenant,
                realm_id: realmId,
                workflow_instance_id: ctx.executionId
            }
        });
    }

    /**
     * Helper to handle missing service ID in invoice item
     */
    async function handleMissingServiceIdError(
        ctx: WorkflowHelperContext,
        {
            item,
            algaInvoice,
            algaInvoiceId,
        }: {
            item: AlgaInvoiceItem;
            algaInvoice: AlgaInvoice;
            algaInvoiceId: string;
        }
    ): Promise<TaskResolutionResult> {
        ctx.logger.warn(`Item ${item.id} is missing service_id. Creating human task.`, { executionId: ctx.executionId });
        ctx.setState(WorkflowState.ERROR);
        
        return await createAndWaitForHumanTask(ctx.actions, {
            taskType: 'workflow_error',
            title: `Item Missing Product/Service: Invoice #${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
            description: `Line item (ID: ${item.id}) on invoice #${algaInvoice?.invoice_number || 'Unknown'} is missing a product/service association. Please associate a product/service with this item or confirm if it should be skipped.`,
            priority: 'medium',
            userId: ctx.userId,
            contextData: {
                message: `Line item (ID: ${item.id}, Amount: ${item.amount || 'N/A'}) on invoice ${algaInvoice?.invoice_id || 'Unknown'} does not have an associated Alga Product/Service. Please associate one. If resolved, submit this task indicating the issue is fixed.`,
                alga_invoice_id: algaInvoiceId,
                item_id: item.id,
                tenant: ctx.tenant,
                workflow_instance_id: ctx.executionId
            }
        });
    }

    /**
     * Process an invoice item for QBO synchronization
     */
    async function processInvoiceItem(
        ctx: WorkflowHelperContext,
        {
            item,
            algaInvoice,
            algaInvoiceId,
            realmId,
            qboCredentials,
            qboInvoiceLines
        }: {
            item: AlgaInvoiceItem;
            algaInvoice: AlgaInvoice;
            algaInvoiceId: string;
            realmId: string;
            qboCredentials: any;
            qboInvoiceLines: any[];
        }
    ): Promise<{ success: boolean; itemAdded: boolean }> {
        let currentItemServiceId = item.service_id;
        let attempts = 0;
        const MAX_ATTEMPTS = 2;

        // If no service ID, handle the error
        if (!currentItemServiceId) {
            const taskResult = await handleMissingServiceIdError(ctx, { item, algaInvoice, algaInvoiceId });
            
            if (taskResult.userFixedTheProblem) {
                // Re-fetch item data to get updated service_id
                const refreshedItemsResult = await ctx.actions.getInvoiceItems({ 
                    invoiceId: algaInvoiceId, 
                    tenantId: ctx.tenant 
                });
                
                if (refreshedItemsResult.success) {
                    const refreshedItem = refreshedItemsResult.items.find(i => i.id === item.id);
                    if (refreshedItem?.service_id) {
                        item.service_id = refreshedItem.service_id;
                        currentItemServiceId = refreshedItem.service_id;
                        ctx.logger.info(`Refreshed item ${item.id} and found service_id: ${currentItemServiceId}`, { executionId: ctx.executionId });
                    } else {
                        ctx.logger.warn(`Item ${item.id} still missing service_id after task resolution and item refresh.`, { executionId: ctx.executionId });
                        return { success: false, itemAdded: false };
                    }
                } else {
                    ctx.logger.warn(`Failed to refresh invoice items after task for item ${item.id}.`, { executionId: ctx.executionId });
                    return { success: false, itemAdded: false };
                }
            } else {
                // User did not fix the issue or task failed
                return { success: false, itemAdded: false };
            }
        }

        // Now that we have a service ID (either initially or after resolution), look up the QBO item ID
        while (attempts < MAX_ATTEMPTS) {
            attempts++;
            ctx.setState(WorkflowState.RUNNING);
            ctx.logger.info(`Processing item ${item.id}, attempt ${attempts}`, { executionId: ctx.executionId });

            try {
                // Verify item has a service ID
                if (!currentItemServiceId) {
                    ctx.logger.error(`Item ${item.id} has no service_id at attempt ${attempts}`, { executionId: ctx.executionId });
                    return { success: false, itemAdded: false };
                }

                // Look up QBO item ID
                const mappingResult = await ctx.actions.lookupQboItemId({ 
                    algaProductId: currentItemServiceId, 
                    tenantId: ctx.tenant, 
                    realmId, 
                    qboCredentials 
                });

                // Handle mapping lookup errors
                if (!mappingResult.success) {
                    ctx.logger.error(`QBO Item lookup action failed for service_id ${currentItemServiceId}.`, { 
                        error: mappingResult.message, 
                        executionId: ctx.executionId 
                    });
                    
                    const taskResLookupFailed = await handleQboApiError(ctx, {
                        error: { message: mappingResult.message },
                        operation: `lookup product mapping for ID ${currentItemServiceId}`,
                        algaInvoiceId,
                        invoiceNumber: algaInvoice?.invoice_number,
                        entityId: item.id,
                        realmId
                    });
                    
                    if (taskResLookupFailed.userFixedTheProblem) {
                        continue; // Retry the lookup
                    } else {
                        return { success: false, itemAdded: false };
                    }
                }

                // Handle case where no mapping was found
                if (!mappingResult.found) {
                    const taskResNotFound = await handleQboItemMappingError(ctx, {
                        serviceId: currentItemServiceId,
                        serviceName: item.service_name,
                        itemId: item.id,
                        algaInvoiceId,
                        invoiceNumber: algaInvoice?.invoice_number,
                        companyId: algaInvoice?.company_id,
                        realmId
                    });
                    
                    if (taskResNotFound.userFixedTheProblem) {
                        continue; // Retry the mapping lookup
                    } else {
                        return { success: false, itemAdded: false };
                    }
                }

                // Verify we have the QBO item ID
                const qboItemId = mappingResult.qboItemId;
                if (!qboItemId) {
                    ctx.logger.error(`QBO Item ID missing after successful lookup for service_id ${currentItemServiceId}.`, { executionId: ctx.executionId });
                    
                    const taskResInternalError = await createAndWaitForHumanTask(ctx.actions, {
                        taskType: 'workflow_error',
                        title: `System Error: QBO Item Lookup - Invoice #${algaInvoice?.invoice_number || 'Unknown'} (Item ID: ${item.id})`,
                        description: `System error: Lookup for product ID ${currentItemServiceId} succeeded but no QBO Item ID returned. Please contact support.`,
                        priority: 'high',
                        userId: ctx.userId,
                        contextData: {
                            message: `System error: QuickBooks item lookup for product ID ${currentItemServiceId} (Invoice #${algaInvoice?.invoice_number || 'Unknown'}) reported success but no QBO item ID. This needs investigation. If issue is understood and resolved, submit task.`,
                        }
                    });
                    
                    if (taskResInternalError.userFixedTheProblem) {
                        continue; // Retry the mapping lookup
                    } else {
                        return { success: false, itemAdded: false };
                    }
                }

                // Add the item to the QBO invoice lines
                qboInvoiceLines.push({
                    Amount: item.amount ?? 0,
                    DetailType: "SalesItemLineDetail",
                    SalesItemLineDetail: { ItemRef: { value: qboItemId } },
                });
                
                ctx.logger.info(`Item ${item.id} (service_id: ${currentItemServiceId}) successfully processed and added to QBO lines.`, { executionId: ctx.executionId });
                return { success: true, itemAdded: true };

            } catch (itemError: any) {
                ctx.logger.error(`Unhandled error during mapping for item ${item.id} (service_id: ${currentItemServiceId}).`, { 
                    error: itemError.message, 
                    executionId: ctx.executionId 
                });
                
                if (attempts >= MAX_ATTEMPTS) {
                    await createAndWaitForHumanTask(ctx.actions, {
                        taskType: 'workflow_error',
                        title: `Unrecoverable Mapping Error - Item ${item.id} on Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                        priority: 'high',
                        description: `Item ${item.id} could not be mapped after ${MAX_ATTEMPTS} attempts. Error: ${itemError.message}. Manual intervention required.`,
                        userId: ctx.userId,
                        contextData: { 
                            message: `Item ${item.id} could not be mapped after ${MAX_ATTEMPTS} attempts. Error: ${itemError.message}. Manual intervention required.`, 
                            alga_item_id: item.id, 
                            alga_invoice_id: algaInvoice?.invoice_id 
                        }
                    });
                    return { success: false, itemAdded: false };
                }
            }
        }
        
        return { success: false, itemAdded: false };
    }

    /**
     * Helper to create or update a QBO invoice
     */
    async function createOrUpdateQboInvoice(
        ctx: WorkflowHelperContext,
        {
            qboInvoiceData,
            realmId,
            qboCredentials,
            algaInvoice,
            algaInvoiceId
        }: {
            qboInvoiceData: QboInvoiceData;
            realmId: string;
            qboCredentials: any;
            algaInvoice: AlgaInvoice;
            algaInvoiceId: string;
        }
    ): Promise<{ success: boolean; result?: { Id: string; SyncToken: string } }> {
        // Declare outside try block so it's available in catch
        let existingQboInvoiceId: string | undefined;
        let existingSyncToken: string | undefined;
        
        try {
            let qboResult: { Id: string; SyncToken: string };
            
            // Check if there's an existing QBO invoice mapping
            ctx.setState(WorkflowState.RUNNING);
            const mappingResult = await ctx.actions.get_external_entity_mapping({
                algaEntityId: algaInvoice.invoice_id,
                externalSystemName: 'quickbooks_online',
                externalRealmId: realmId,
                algaEntityType: 'invoice', // Specify entity type to avoid default of 'company'
                tenantId: ctx.tenant
            });
            
            if (mappingResult.success && mappingResult.found && mappingResult.mapping) {
                existingQboInvoiceId = mappingResult.mapping.externalEntityId;
                existingSyncToken = mappingResult.mapping.metadata?.syncToken;
                ctx.logger.info(`Found existing QBO invoice mapping`, { 
                    qbo_invoice_id: existingQboInvoiceId,
                    sync_token: existingSyncToken, 
                    executionId: ctx.executionId 
                });
            }
            
            // Determine if we're creating or updating
            if (existingQboInvoiceId && existingSyncToken) {
                ctx.setState(WorkflowState.RUNNING);
                ctx.logger.info(`Calling QBO API to update existing invoice`, { 
                    qbo_invoice_id: existingQboInvoiceId, 
                    executionId: ctx.executionId 
                });
                
                const updateResult = await ctx.actions.updateQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    qboSyncToken: existingSyncToken,
                    tenantId: ctx.tenant,
                    realmId: realmId,
                    qboCredentials
                });
                
                if (!updateResult.success || !updateResult.qboResponse) {
                    throw new Error(`Failed to update QBO invoice: ${updateResult.message || 'Unknown error'}`);
                }
                
                // Set qboResult to the structure expected by the rest of the function
                qboResult = {
                    Id: updateResult.Id || updateResult.qboResponse.Id,
                    SyncToken: updateResult.SyncToken || updateResult.qboResponse.SyncToken
                };
                
                ctx.logger.info('Successfully updated invoice in QBO.', { 
                    qbo_invoice_id: qboResult.Id, 
                    executionId: ctx.executionId 
                });
            } else {
                ctx.setState(WorkflowState.RUNNING);
                ctx.logger.info(`Calling QBO API to create new invoice`, { executionId: ctx.executionId });
                
                const createResult = await ctx.actions.createQboInvoice({
                    qboInvoiceData: qboInvoiceData,
                    tenantId: ctx.tenant,
                    realmId: realmId,
                    qboCredentials
                });
                
                if (!createResult.success || !createResult.qboResponse) {
                    throw new Error(`Failed to create QBO invoice: ${createResult.message || 'Unknown error'}`);
                }
                
                // Set qboResult to the structure expected by the rest of the function
                qboResult = {
                    Id: createResult.Id || createResult.qboResponse.Id,
                    SyncToken: createResult.SyncToken || createResult.qboResponse.SyncToken
                };
                
                ctx.logger.info('Successfully created invoice in QBO.', { 
                    qbo_invoice_id: qboResult.Id, 
                    executionId: ctx.executionId 
                });
            }
            
            // Store QBO invoice mapping
            ctx.setState(WorkflowState.RUNNING);
            if (!algaInvoice.invoice_id) {
                throw new Error('Critical: algaInvoice.invoice_id is undefined when trying to update Alga with QBO details');
            }
            
            // Validate that we have the required QBO invoice details
            if (!qboResult.Id) {
                throw new Error('Critical: QBO invoice ID is undefined after successful creation/update');
            }
            
            if (!qboResult.SyncToken) {
                ctx.logger.warn(`QBO SyncToken is missing after successful operation, defaulting to "0"`, {
                    qbo_invoice_id: qboResult.Id,
                    executionId: ctx.executionId
                });
                qboResult.SyncToken = "0"; // Default sync token if missing
            }
            
            ctx.logger.info(`Storing QBO invoice mapping with ID: ${qboResult.Id} and SyncToken: ${qboResult.SyncToken}`, {
                alga_invoice_id: algaInvoice.invoice_id,
                executionId: ctx.executionId
            });
            
            const mappingUpdateResult = await ctx.actions.create_or_update_external_entity_mapping({
                algaEntityType: 'invoice',
                algaEntityId: algaInvoice.invoice_id,
                externalSystemName: 'quickbooks_online',
                externalEntityId: qboResult.Id,
                externalRealmId: realmId,
                metadata: { syncToken: qboResult.SyncToken },
                tenantId: ctx.tenant
            });
            
            if (!mappingUpdateResult.success) {
                ctx.logger.error('Failed to update external entity mapping.', { 
                    error: mappingUpdateResult.message, 
                    executionId: ctx.executionId 
                });
                throw new Error(`Failed to update external entity mapping: ${mappingUpdateResult.message}`);
            }
            
            ctx.logger.info('Successfully saved QBO invoice mapping.', { 
                invoiceId: algaInvoice.invoice_id, 
                qboInvoiceId: qboResult.Id, 
                executionId: ctx.executionId 
            });
            
            return { success: true, result: qboResult };
            
        } catch (error: any) {
            const taskResult = await handleQboApiError(ctx, {
                error,
                operation: existingQboInvoiceId ? 'update the existing invoice' : 'create a new invoice',
                algaInvoiceId,
                invoiceNumber: algaInvoice.invoice_number,
                realmId
            });
            
            if (taskResult.userFixedTheProblem) {
                // User fixed the problem, recursively retry the operation
                return createOrUpdateQboInvoice(ctx, {
                    qboInvoiceData,
                    realmId,
                    qboCredentials,
                    algaInvoice,
                    algaInvoiceId
                });
            }
            
            return { success: false };
        }
    }
    

    // Create helper context for utility functions
    const helperContext: WorkflowHelperContext = {
        actions: typedActions,
        logger,
        setState,
        data,
        tenant,
        executionId,
        userId
    };
    
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
        setState(WorkflowState.ERROR);
        await createAndWaitForHumanTask(typedActions, {
            taskType: 'workflow_error',
            title: 'Missing Critical Context for QBO Invoice Sync',
            description: 'The workflow is missing required context: tenant, realmId, or invoiceId.',
            priority: 'high',
            userId,
            contextData: {
                message: 'Missing critical context for QBO Invoice Sync workflow. The workflow requires tenant, realmId, and invoiceId to proceed.',
                tenant,
                realmId,
                algaInvoiceId,
                executionId
            }
        });
        return;
    }

    // Initialize or resume workflow state
    if (currentState === null) {
        setState(WorkflowState.RUNNING);
    } else if (currentState !== 'RUNNING' && currentState !== null) {
        logger.info(`Resuming workflow from state: ${currentState}`, { executionId });
        setState(WorkflowState.RUNNING);
    }

    logger.info('Workflow context initialized.', { tenant, realmId, triggerEventName, algaInvoiceId, executionId });

    try {
        // Helper function to fetch required invoice data
        async function fetchRequiredData(): Promise<{ 
            success: boolean; 
            algaInvoice?: AlgaInvoice; 
            algaInvoiceItems?: AlgaInvoiceItem[]; 
            algaCompany?: AlgaCompany;
        }> {
            logger.info('Fetching required invoice data', { executionId });
            setState(WorkflowState.RUNNING);
            
            try {
                // Fetch invoice
                const invoice = await typedActions.getInvoice({ id: algaInvoiceId, tenantId: tenant });
                logger.info('Fetched invoice data', { invoice_number: invoice?.invoice_number, executionId });

                if (!invoice?.company_id) {
                    logger.error('Fetched invoice is missing company_id.', { alga_invoice_id: algaInvoiceId, tenant, executionId });
                    await createAndWaitForHumanTask(typedActions, {
                        taskType: 'workflow_error',
                        title: `Invalid Invoice Data: Missing Company (Invoice ID: ${algaInvoiceId})`,
                        description: `The invoice data is missing a required company ID. This invoice cannot be synchronized with QuickBooks.`,
                        priority: 'high',
                        userId,
                        contextData: {
                            message: `The invoice ${algaInvoiceId} is missing a required company ID. Please ensure the invoice is associated with a company.`,
                            alga_invoice_id: algaInvoiceId,
                            tenant,
                            workflow_instance_id: executionId
                        }
                    });
                    return { success: false };
                }

                // Fetch invoice items and company data in parallel
                const [invoiceItemsResult, company] = await Promise.all([
                    typedActions.getInvoiceItems({ invoiceId: algaInvoiceId, tenantId: tenant }),
                    typedActions.getCompany({ id: invoice.company_id, tenantId: tenant })
                ]);

                // Validate invoice items result
                if (!invoiceItemsResult || !invoiceItemsResult.success) {
                    logger.error('Failed to fetch invoice items.', { alga_invoice_id: algaInvoiceId, tenant, result: invoiceItemsResult, executionId });
                    
                    await createAndWaitForHumanTask(typedActions, {
                        taskType: 'workflow_error',
                        title: `Failed to Fetch Invoice Items for Invoice #${invoice.invoice_number || algaInvoiceId}`,
                        description: `The system failed to fetch invoice items for invoice #${invoice.invoice_number || algaInvoiceId}. Error: ${invoiceItemsResult?.message || 'Unknown error'}`,
                        priority: 'high',
                        userId,
                        contextData: {
                            message: `Failed to fetch invoice items for invoice #${invoice.invoice_number || algaInvoiceId}. This is needed to sync with QuickBooks.`,
                            alga_invoice_id: algaInvoiceId,
                            tenant,
                            error: invoiceItemsResult?.error,
                            workflow_instance_id: executionId
                        }
                    });
                    return { success: false };
                }

                const invoiceItems = invoiceItemsResult.items;

                // Validate company data
                if (!company) {
                    logger.error('Failed to fetch company data.', { alga_invoice_id: algaInvoiceId, company_id: invoice.company_id, executionId });
                    
                    await createAndWaitForHumanTask(typedActions, {
                        taskType: 'workflow_error',
                        title: `Failed to Fetch Company Data for Invoice #${invoice.invoice_number || algaInvoiceId}`,
                        description: `The system failed to fetch company data (ID: ${invoice.company_id}) for invoice #${invoice.invoice_number || algaInvoiceId}.`,
                        priority: 'high',
                        userId,
                        contextData: {
                            message: `Failed to fetch company data with ID ${invoice.company_id} needed for QuickBooks synchronization.`,
                            alga_invoice_id: algaInvoiceId,
                            company_id: invoice.company_id,
                            tenant,
                            workflow_instance_id: executionId
                        }
                    });
                    return { success: false };
                }

                // Store all data in workflow context
                data.set('algaInvoice', invoice);
                data.set('algaInvoiceItems', invoiceItems);
                data.set('algaCompany', company);
                
                logger.info('Successfully fetched all required data', { 
                    invoice_number: invoice.invoice_number, 
                    items_count: invoiceItems.length, 
                    company_id: company.company_id,
                    executionId 
                });
                
                return { 
                    success: true, 
                    algaInvoice: invoice, 
                    algaInvoiceItems: invoiceItems, 
                    algaCompany: company 
                };
            } catch (error: any) {
                logger.error('Exception occurred while fetching required data', { 
                    error: error.message, 
                    stack: error.stack,
                    executionId 
                });
                
                await createAndWaitForHumanTask(typedActions, {
                    taskType: 'workflow_error',
                    title: `System Error Fetching Data for Invoice #${algaInvoiceId}`,
                    description: `The system encountered an error while fetching data for invoice #${algaInvoiceId}. Error: ${error.message}`,
                    priority: 'high',
                    userId,
                    contextData: {
                        message: `System error fetching data for invoice #${algaInvoiceId}: ${error.message}`,
                        alga_invoice_id: algaInvoiceId,
                        tenant,
                        error_stack: error.stack,
                        workflow_instance_id: executionId
                    }
                });
                return { success: false };
            }
        }

        // Check if we need to fetch data or if it's already in the workflow context
        let algaInvoice = data.get<AlgaInvoice>('algaInvoice');
        let retrievedInvoiceItemsArray = data.get<AlgaInvoiceItem[]>('algaInvoiceItems');
        let algaCompany = data.get<AlgaCompany>('algaCompany');
        
        if (!algaInvoice || !retrievedInvoiceItemsArray || !algaCompany) {
            // Fetch all required data
            const fetchResult = await fetchRequiredData();
            if (!fetchResult.success) {
                setState(WorkflowState.ERROR);
                return;
            }
            
            // Update local variables with fetched data
            algaInvoice = data.get<AlgaInvoice>('algaInvoice');
            retrievedInvoiceItemsArray = data.get<AlgaInvoiceItem[]>('algaInvoiceItems') || [];
            algaCompany = data.get<AlgaCompany>('algaCompany');
            
            // Final validation of data
            if (!algaInvoice || !retrievedInvoiceItemsArray || !algaCompany) {
                logger.error('Critical: Core data still missing after fetch.', { algaInvoiceId, executionId });
                setState(WorkflowState.ERROR);
                return;
            }
        }
        
        // Initialize the customer ID for QBO
        let qboCustomerIdToUse: string | undefined = algaCompany?.qbo_customer_id;
        
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
                setState("ERROR");
                await typedActions.createTaskAndWaitForResult({
                    taskType: 'workflow_error',
                    title: `Critical: Invoice Data Missing for Customer Processing (Invoice ID: ${algaInvoiceId})`,
                    description: `The workflow encountered a critical error while processing invoice ${algaInvoiceId}. The invoice data is missing or incomplete. Please investigate the issue.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `Critical error: Invoice data is missing or incomplete for invoice ${algaInvoiceId}. Please investigate.`,
                        alga_invoice_id: algaInvoiceId,
                        tenant,
                        realm_id: realmId!,
                        workflow_instance_id: executionId
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
                    setState("ERROR");
                    await typedActions.createTaskAndWaitForResult({
                        taskType: 'workflow_error',
                        title: `Critical: AlgaCompany Data Missing for Customer Processing (Invoice ID: ${algaInvoiceId})`,
                        description: `The workflow encountered a critical error while processing invoice ${algaInvoiceId}. The AlgaCompany data is missing or incomplete. Please investigate the issue.`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Critical error: AlgaCompany data is missing or incomplete for invoice ${algaInvoiceId}. Please investigate.`,
                            alga_invoice_id: algaInvoiceId,
                            tenant,
                            realm_id: realmId!,
                            workflow_instance_id: executionId
                        },
                    });
                    return; // Terminal workflow failure
                 }
            }
            
            qboCustomerIdForInvoice = currentAlgaCompany.qbo_customer_id; // Initialize with current known ID from the (potentially refreshed) company object

            logger.info(`Processing company ${currentAlgaCompany.company_id}, current QBO Customer ID from company object: ${qboCustomerIdForInvoice || 'None'}.`, { executionId });

            // Part 1: Attempt to get QBO Customer ID from existing mapping
            setState(WorkflowState.RUNNING);
            logger.info('Checking for QBO Customer mapping.', { company_id: currentAlgaCompany.company_id, executionId });
            const mappingLookupResult = await typedActions.get_external_entity_mapping({
                algaEntityId: currentAlgaCompany.company_id,
                externalSystemName: 'quickbooks_online',
                externalRealmId: realmId!, // realmId is validated at the start of the workflow
                algaEntityType: 'company', // Explicitly specify entity type for clarity
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
                setState(WorkflowState.ERROR);
                const taskResolution = await typedActions.createTaskAndWaitForResult({
                    taskType: 'workflow_error',
                    title: `Resolve Customer Mapping Lookup: Invoice #${algaInvoice?.invoice_number || algaInvoiceId}`,
                    description: `The workflow failed to look up QBO customer mapping for Alga Company ID ${currentAlgaCompany.company_id} in Realm ${realmId}. Error: ${mappingLookupResult.message || 'Unknown error'}. Please investigate and confirm resolution.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `The workflow failed to look up QBO customer mapping for Alga Company ID ${currentAlgaCompany.company_id}. Error: ${mappingLookupResult.message}. Please investigate.`,
                    },
                });
                if (taskResolution.success && taskResolution.resolutionData?.userFixedTheProblem) {
                    logger.info('User indicated mapping lookup action issue resolved. Retrying customer processing loop.', { executionId, taskId: taskResolution.taskId });
                    continue; // Retry the while loop
                } else {
                    logger.warn('Customer mapping lookup action error not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolution.taskId, resolution: taskResolution.resolutionData });
                    setState(WorkflowState.ERROR);
                    return; // Terminal workflow failure
                }
            }

            // Part 2: If no QBO Customer ID yet (qboCustomerIdForInvoice is undefined), trigger and await qboCustomerSyncWorkflow
            if (!qboCustomerIdForInvoice) {
                logger.warn('QBO Customer ID is not yet resolved. Triggering Customer Sync.', { company_id: currentAlgaCompany.company_id, executionId });
                setState(WorkflowState.RUNNING);

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

                setState(WorkflowState.RUNNING);
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
                    setState(WorkflowState.ERROR);
                    const taskResolution = await typedActions.createTaskAndWaitForResult({
                        taskType: 'workflow_error',
                        title: `Customer Sync Failed for Invoice ${algaInvoice?.invoice_number || algaInvoiceId}`,
                        description: `The customer sync for Company ID ${currentAlgaCompany.company_id} (related to Invoice ${algaInvoice?.invoice_number || algaInvoiceId}) failed. Error: ${customerSyncOutcomeEvent.payload?.error_message || 'Unknown error from customer sync'}. Please resolve the customer sync issue. You can then choose to retry syncing this invoice.`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Customer sync failed for Company ID ${currentAlgaCompany.company_id}. Error: ${customerSyncOutcomeEvent.payload?.error_message}. Resolve and then decide to retry invoice sync.`,
                        }
                    });
                    if (taskResolution.success && taskResolution.resolutionData?.userFixedTheProblem) {
                        logger.info('User indicated customer sync failure resolved. Retrying customer processing loop.', { executionId, taskId: taskResolution.taskId });
                        // Implicitly continue to the next iteration of the while loop
                    } else {
                        logger.warn('Customer sync failure not resolved by user or task failed. Halting invoice sync.', { executionId, taskId: taskResolution.taskId, resolution: taskResolution.resolutionData });
                        setState(WorkflowState.ERROR);
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

        // Fetch QBO credentials using helper function
        const qboCredentialsResult = await fetchQboCredentials(helperContext, realmId!, algaInvoiceId);
        
        if (!qboCredentialsResult.success || !qboCredentialsResult.credentials) {
            logger.error('Failed to fetch QBO credentials after helper function execution.', { executionId });
            setState(WorkflowState.ERROR);
            return; // Terminal workflow failure, task already created by helper
        }
        
        const qboCredentials = qboCredentialsResult.credentials;

        setState(WorkflowState.RUNNING);
        const qboInvoiceLines: any[] = [];
        const itemsToIterate = Array.isArray(retrievedInvoiceItemsArray) ? retrievedInvoiceItemsArray : [];
        let allItemsProcessedSuccessfully = true;
        
        // Process each invoice item using our helper function
        for (const item of itemsToIterate) {
            const itemResult = await processInvoiceItem(helperContext, {
                item,
                algaInvoice,
                algaInvoiceId,
                realmId: realmId!,
                qboCredentials,
                qboInvoiceLines
            });
            
            // Track if any items failed to process successfully
            if (!itemResult.success) {
                allItemsProcessedSuccessfully = false;
            }
        }
        
        // Check if we have any successful items
        if (qboInvoiceLines.length === 0 && itemsToIterate.length > 0) {
            logger.warn('No line items were successfully mapped to QBO items.', { executionId });
            setState(WorkflowState.ERROR);
            
            await createAndWaitForHumanTask(typedActions, {
                taskType: 'workflow_error',
                title: `No Products Could Be Mapped - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                description: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced because none of its line items could be mapped to QuickBooks items.`,
                priority: 'high',
                userId: context.userId,
                contextData: {
                    message: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} could not be synced to QuickBooks because none of its line items could be mapped to QuickBooks items. This usually indicates that multiple products need to be mapped in the QuickBooks integration settings. Please check the individual product mapping errors for more details.`,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    tenant: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId
                }
            });
            return;
        } else if (!allItemsProcessedSuccessfully && qboInvoiceLines.length > 0) {
            // Some items processed successfully, but not all
            logger.warn(`Some line items failed to map for invoice #${algaInvoice?.invoice_number || 'Unknown'}. Proceeding with successfully mapped items.`, { executionId });
            
            await createAndWaitForHumanTask(typedActions, {
                taskType: 'workflow_error',
                title: `Partial Item Mapping - Invoice #${algaInvoice?.invoice_number || 'Unknown'}`,
                description: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} was synced to QuickBooks, but some line items could not be mapped and were excluded. Please review.`,
                priority: 'medium',
                userId: context.userId,
                contextData: {
                    message: `Invoice #${algaInvoice?.invoice_number || 'Unknown'} was synced to QuickBooks, but one or more line items could not be mapped after attempts and were excluded. Please review the individual item mapping errors for details. The invoice in QuickBooks may be incomplete.`,
                    alga_invoice_id: algaInvoice?.invoice_id || 'Unknown',
                    successfully_mapped_items_count: qboInvoiceLines.length,
                    total_items_attempted: itemsToIterate.length,
                    tenant: tenant,
                    realm_id: realmId,
                    workflow_instance_id: executionId
                }
            });
            // Continue with the workflow since we have at least some items mapped
        }


        logger.info(`Successfully prepared ${qboInvoiceLines.length} line items for QBO invoice.`, { executionId });

        const qboTermId = algaCompany.qbo_term_id;
        if (!qboTermId) {
            logger.warn('QBO Term ID not found on company or lookup failed. Proceeding without term.', { company_id: algaCompany.company_id, executionId });
        }

        // Verify we have a QBO customer ID to use
        if (!qboCustomerIdToUse) {
            setState(WorkflowState.ERROR);
            
            await createAndWaitForHumanTask(typedActions, {
                taskType: 'workflow_error',
                title: `System Error: Missing Customer - Invoice #${algaInvoice.invoice_number}`,
                description: `Cannot sync invoice because the system couldn't find a QuickBooks customer for company ID ${algaCompany.company_id}.`,
                priority: 'high',
                userId: context.userId,
                contextData: {
                    message: `System error: The workflow couldn't find a QuickBooks customer ID for company ${algaCompany.company_id} when trying to sync invoice #${algaInvoice.invoice_number}. This indicates either a mapping issue or a system error. Please ensure the company is properly mapped to a QuickBooks customer or contact technical support.`,
                    alga_invoice_id: algaInvoiceId,
                    tenant: tenant,
                    company_id: algaCompany.company_id,
                    workflow_instance_id: executionId
                }
            });
            
            logger.warn('Skipping invoice sync for INTERNAL_ERROR_CUSTOMER_ID_MISSING as sync status is handled elsewhere.', { 
                invoiceId: algaInvoice.invoice_id, 
                executionId 
            });
            return;
        }

        // Prepare the QBO invoice data
        const qboInvoiceData: QboInvoiceData = {
            Line: qboInvoiceLines,
            CustomerRef: { value: qboCustomerIdToUse },
            DocNumber: algaInvoice.invoice_number,
        };
        data.set('qboInvoiceData', qboInvoiceData);

        // Create or update the QBO invoice using our helper function
        const qboApiResult = await createOrUpdateQboInvoice(helperContext, {
            qboInvoiceData,
            realmId: realmId!,
            qboCredentials,
            algaInvoice,
            algaInvoiceId
        });
        
        if (!qboApiResult.success) {
            // Error already handled by the helper function
            logger.error('Failed to create or update QBO invoice after all attempts. Halting workflow.', { executionId });
            setState(WorkflowState.ERROR);
            return;
        }
        
        // Successfully created or updated the invoice
        setState(WorkflowState.COMPLETE);
        logger.info('QBO invoice sync completed successfully.', { 
            qbo_invoice_id: qboApiResult.result?.Id, 
            invoice_number: algaInvoice.invoice_number,
            executionId 
        });

    } catch (workflowError: any) {
        logger.error('Unhandled error during QBO Invoice Sync workflow execution.', { 
            error: workflowError?.message, 
            stack: workflowError?.stack, 
            executionId 
        });
        setState(WorkflowState.ERROR);

        // Store the error info in workflow context
        const errorInfo = { 
            message: workflowError?.message, 
            stack: workflowError?.stack 
        };
        data.set('workflowError', errorInfo);

        // Try to get the invoice ID from various sources
        let algaInvoiceIdForError = algaInvoiceId; // Default from trigger payload
        
        // Try to get more specific info from data store if available
        const dataStoreInvoice = data.get<AlgaInvoice>('algaInvoice');
        if (dataStoreInvoice?.invoice_id) {
            algaInvoiceIdForError = dataStoreInvoice.invoice_id;
        }

        // Create a human task for the unexpected error
        await createAndWaitForHumanTask(typedActions, {
            taskType: 'workflow_error',
            title: `System Error: QuickBooks Invoice Sync Failed - Invoice #${algaInvoiceIdForError ?? 'Unknown'}`,
            description: `The QuickBooks invoice sync workflow encountered an unexpected error. Technical support may be needed.`,
            priority: 'high',
            userId: context.userId,
            contextData: {
                message: `The QuickBooks invoice sync workflow encountered an unexpected system error while processing invoice #${algaInvoiceIdForError ?? 'Unknown'}. Error: ${workflowError?.message || 'Unknown error'}. This may indicate a problem with the workflow configuration or the QuickBooks integration service. Please notify technical support with the workflow instance ID: ${executionId}.`,
                error_stack: workflowError?.stack,
                alga_invoice_id: algaInvoiceIdForError,
                tenant,
                realm_id: realmId,
                workflow_instance_id: executionId
            }
        });

    } finally {
        logger.info(`QBO Invoice Sync workflow execution finished. Instance ID: ${executionId}. Final state: ${getCurrentState()}`);
    }
}