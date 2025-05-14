import { WorkflowContext, CreateTaskAndWaitForResultParams, CreateTaskAndWaitForResultReturn } from '../../../../shared/workflow/core';
// TODO: Import specific types for Alga Company, QBO Customer, Human Task, etc.
// import { AlgaCompany } from '...';
// import { QboCustomer } from '...';
// import { HumanTaskInput } from '...';

// Define placeholder types if real ones are not available yet
type AlgaCompany = any;
type QboCustomerInput = any;
type QboCustomerResult = any;
type HumanTaskInput = any;
type TriggerEventPayload = {
  realmId: string;
  company_id: string; // Corrected to match actual payload
  originatingWorkflowInstanceId?: string;
  successEventName?: string;
  failureEventName?: string;
  tenantId?: string; 
};

type TriggerEvent = {
  name: string; // e.g., "CUSTOMER_SYNC_REQUESTED"
  payload: TriggerEventPayload;
};

// Define possible states for the workflow
type WorkflowState =
  | 'INITIAL'
  | 'FETCHING_DATA'
  | 'MAPPING_DATA'
  | 'MAPPING_ERROR'
  | 'CHECKING_QBO_DUPLICATES' // Optional step
  | 'DUPLICATE_CHECK_REQUIRED' // Optional step
  | 'CALLING_QBO_CREATE'
  | 'CALLING_QBO_UPDATE'
  | 'QBO_API_ERROR'
  | 'UPDATING_ALGA'
  | 'SYNC_COMPLETE';


/**
 * Workflow to synchronize Alga PSA Company data to QuickBooks Online Customer.
 * Triggered by COMPANY_CREATED or COMPANY_UPDATED events.
 */
export async function qboCustomerSyncWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger, setState, getCurrentState, tenant, executionId, userId } = context;

  const ENTITY_TYPE_CUSTOMER = "Customer";

  // 1. Initialization & State
  setState('INITIAL');
  logger.info('QBO Customer Sync workflow started', { tenantId: tenant, executionId });

  // 2. Trigger Event & Context
  let triggerEvent = data.get<TriggerEvent>('triggerEvent'); // Initial fetch from context.data
  let triggerEventValidated = false;

  // Helper to emit failure event before exiting
  const emitFailureEventIfNeeded = async (errorMessage: string, companyIdForEvent?: string, realmIdForEvent?: string) => {
    const originatingWorkflowId = triggerEvent?.payload?.originatingWorkflowInstanceId;
    const failEventName = triggerEvent?.payload?.failureEventName;
    const payload = {
      originatingWorkflowInstanceId: originatingWorkflowId,
      company_id: companyIdForEvent || triggerEvent?.payload?.company_id,
      error_message: errorMessage,
      realmId: realmIdForEvent || triggerEvent?.payload?.realmId,
      tenantId: tenant,
    };
    logger.info(`Preparing to emit failure event: ${failEventName}`, { payload, executionId });
    if (failEventName && originatingWorkflowId) {
      await events.emit(failEventName, payload);
      logger.info(`Failure event ${failEventName} emitted successfully.`, { payload, executionId });
    } else {
      logger.warn(`Failure event not emitted. Missing failEventName or originatingWorkflowId.`, { failEventName, originatingWorkflowId, executionId });
    }
  };

  while (!triggerEventValidated) {
    if (!triggerEvent || !triggerEvent.payload) {
      logger.error('Missing triggerEvent or its payload in workflow context data', { tenantId: tenant, executionId, contextData: triggerEvent });
      setState('MAPPING_ERROR');
      const taskParamsMissingTrigger: CreateTaskAndWaitForResultParams = {
        taskType: 'internal_workflow_error',
        title: 'Workflow Input Error: Missing Trigger Event',
        description: 'The QBO Customer Sync workflow was triggered without a valid triggerEvent or payload. Please provide the necessary trigger information or cancel.',
        priority: 'high',
        assignTo: userId ? { users: [userId] } : undefined,
        contextData: {
          message: 'The QBO Customer Sync workflow was triggered without a valid triggerEvent or payload. Investigation needed.',
          executionId: executionId,
          tenantId: tenant,
          currentContextData: triggerEvent,
        },
      };
      const taskResolution: CreateTaskAndWaitForResultReturn = await actions.createTaskAndWaitForResult(taskParamsMissingTrigger);
      if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
        const errorMsg = `User cancelled or task resolution failed for missing trigger event. TaskId: ${taskResolution.taskId}`;
        logger.warn(errorMsg, { error: taskResolution.error });
        await emitFailureEventIfNeeded(errorMsg);
        return; 
      }
      triggerEvent = data.get<TriggerEvent>('triggerEvent'); // Re-fetch, assuming task might update context.data
    } else {
      triggerEventValidated = true;
    }
  }

  if (!triggerEvent || !triggerEvent.payload) {
    const errorMsg = 'CRITICAL WORKFLOW FAILURE: Trigger event still null after validation loop.';
    logger.error(errorMsg, { executionId, tenant });
    await emitFailureEventIfNeeded(errorMsg);
    return;
  }

  let realmId = triggerEvent.payload.realmId;
  let algaCompanyId = triggerEvent.payload.company_id;
  const originatingWorkflowInstanceId = triggerEvent.payload.originatingWorkflowInstanceId;
  const successEventName = triggerEvent.payload.successEventName;
  const failureEventName = triggerEvent.payload.failureEventName; // Already captured for emitFailureEventIfNeeded

  let criticalIdsValidated = false;
  while (!criticalIdsValidated) {
    if (!realmId || !algaCompanyId) {
      logger.error('Missing realmId or algaCompanyId in triggerEvent payload', { payload: triggerEvent.payload, tenantId: tenant, executionId });
      setState('MAPPING_ERROR');
      const taskParamsMissingIds: CreateTaskAndWaitForResultParams = {
        taskType: 'internal_workflow_error',
        title: 'Workflow Input Error: Missing Critical IDs',
        description: 'The QBO Customer Sync workflow was triggered without realmId or algaCompanyId in the payload. Please provide these IDs or cancel.',
        priority: 'high',
        assignTo: userId ? { users: [userId] } : undefined,
        contextData: {
          message: 'The QBO Customer Sync workflow was triggered without realmId or algaCompanyId in the payload. Investigation needed.',
          currentPayload: triggerEvent.payload,
          executionId: executionId,
          tenantId: tenant,
        },
      };
      const taskResolution: CreateTaskAndWaitForResultReturn = await actions.createTaskAndWaitForResult(taskParamsMissingIds);
      if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
        const errorMsg = `User cancelled or task resolution failed for missing critical IDs. TaskId: ${taskResolution.taskId}`;
        logger.warn(errorMsg, { error: taskResolution.error });
        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
        return; 
      }
      const currentTriggerPayload = data.get<TriggerEvent>('triggerEvent')?.payload; // Re-fetch
      realmId = currentTriggerPayload?.realmId || realmId;
      algaCompanyId = currentTriggerPayload?.company_id || algaCompanyId;
    } else {
      criticalIdsValidated = true;
    }
  }

  if (!realmId || !algaCompanyId) {
    const errorMsg = 'CRITICAL WORKFLOW FAILURE: realmId or algaCompanyId still null after validation loop.';
    logger.error(errorMsg, { executionId, tenant });
    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
    return;
  }

  logger.info('Processing trigger event payload', { eventName: triggerEvent.name, realmId, algaCompanyId, originatingWorkflowInstanceId, successEventName, failureEventName, tenantId: tenant, executionId });

  try {
    // 3. Data Fetching
    setState('FETCHING_DATA');
    logger.info('Fetching Alga Company data', { algaCompanyId, tenantId: tenant });
    
    let algaCompany: AlgaCompany; // Will be assigned in the loop
    let algaCompanyFetchedSuccessfully = false;
    while (!algaCompanyFetchedSuccessfully) {
        const fetchedCompany: AlgaCompany = await actions.getCompany({ id: algaCompanyId, tenantId: tenant });
        if (!fetchedCompany) {
            logger.error('Alga Company not found', { algaCompanyId, tenantId: tenant });
            setState('MAPPING_ERROR'); // Or 'DATA_NOT_FOUND_NEEDS_RESOLUTION'
            const taskParamsCompanyNotFound: CreateTaskAndWaitForResultParams = {
                taskType: 'internal_workflow_error', // More specific taskType
                title: 'Workflow Data Error: Alga Company Not Found',
                description: `Could not fetch Alga Company data for ID: ${algaCompanyId}. Please ensure the company exists and is accessible, or provide corrected information if applicable.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `Could not fetch Alga Company data for ID: ${algaCompanyId}. The company may not exist or there was an issue with the data fetching action.`,
                    algaCompanyId: algaCompanyId, // The ID that failed
                    executionId: executionId,
                    tenantId: tenant,
                },
            };
            const taskResolution: CreateTaskAndWaitForResultReturn = await actions.createTaskAndWaitForResult(taskParamsCompanyNotFound);

            if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                const errorMsg = `User cancelled or task resolution indicated no fix for Alga Company not found. TaskId: ${taskResolution.taskId}`;
                logger.warn(errorMsg, { error: taskResolution.error });
                await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                return; 
            }
            // If task allows providing a new algaCompanyId, it should be handled here.
            // For now, assume the task is about fixing the environment for the existing algaCompanyId.
            // Or, if taskResolution.resolutionData.newCompanyId exists, update algaCompanyId for next attempt.
        } else {
            algaCompany = fetchedCompany;
            algaCompanyFetchedSuccessfully = true;
        }
    }
    // algaCompany is now guaranteed to be defined here if loop exited normally.
    // Add safeguard for type checking, though logic implies it's set.
    if (!algaCompany) { // This check should ideally be unreachable if the loop logic is correct
        const errorMsg = 'CRITICAL WORKFLOW FAILURE: AlgaCompany is null after fetch loop.';
        logger.error(errorMsg, { executionId, tenant, algaCompanyId });
        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
        return; 
    }

    data.set('algaCompany', algaCompany);
    logger.info('Alga Company data fetched successfully', { algaCompanyId, tenantId: tenant });

    // 4. Data Mapping
    setState('MAPPING_DATA');
    logger.info('Mapping Alga Company data to QBO Customer format', { algaCompanyId, tenantId: tenant });

    // TODO: Refine mapping based on actual AlgaCompany and QboCustomer types
    const qboCustomerData: QboCustomerInput = {
        DisplayName: algaCompany.company_name,
        PrimaryEmailAddr: { Address: algaCompany.email }, // Assuming 'email' field exists
        PrimaryPhone: { FreeFormNumber: algaCompany.phone }, // Assuming 'phone' field exists
        BillAddr: { // Assuming address fields exist and map like this
            Line1: algaCompany.billingAddress?.line1,
            City: algaCompany.billingAddress?.city,
            CountrySubDivisionCode: algaCompany.billingAddress?.state, // Or province
            PostalCode: algaCompany.billingAddress?.postalCode,
            Country: algaCompany.billingAddress?.country,
        },
        ShipAddr: { // Assuming shipping address fields exist
            Line1: algaCompany.shippingAddress?.line1,
            City: algaCompany.shippingAddress?.city,
            CountrySubDivisionCode: algaCompany.shippingAddress?.state,
            PostalCode: algaCompany.shippingAddress?.postalCode,
            Country: algaCompany.shippingAddress?.country,
        },
        // Add other relevant fields: Notes, WebAddr, etc.
    };

    // Map Payment Terms
    if (algaCompany.paymentTerm) { 
        let termMappedSuccessfully = false;
        let currentAlgaPaymentTerm = algaCompany.paymentTerm; // Use a variable that might be updated by task

        while (!termMappedSuccessfully) {
            try {
                const qboTermId = await actions.lookupQboTermId({
                    algaTermIdentifier: currentAlgaPaymentTerm,
                    tenantId: tenant,
                    realmId: realmId
                });

                if (qboTermId) {
                    qboCustomerData.SalesTermRef = { value: qboTermId };
                    termMappedSuccessfully = true;
                } else {
                    logger.warn('QBO Term ID not found for Alga term', { algaTerm: currentAlgaPaymentTerm, algaCompanyId, tenantId: tenant, realmId });
                    setState('MAPPING_ERROR');
                    const taskParamsTermMappingMissing: CreateTaskAndWaitForResultParams = {
                        taskType: 'qbo_mapping_error', // Specific task type
                        title: `QBO Term Mapping Missing for Company ${algaCompany.name}`,
                        description: `Could not find a corresponding QBO Term for Alga term: ${currentAlgaPaymentTerm}. Please ensure the mapping exists or provide the correct Alga term/QBO Term ID.`,
                        priority: 'medium',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Could not find a corresponding QBO Term for Alga term: ${currentAlgaPaymentTerm}`,
                            algaCompanyId: algaCompanyId,
                            algaCompanyName: algaCompany.name,
                            currentAlgaTerm: currentAlgaPaymentTerm,
                            realmId: realmId,
                            workflow_instance_id: executionId,
                        },
                    };
                    const taskResolution = await actions.createTaskAndWaitForResult(taskParamsTermMappingMissing);

                    if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                        const errorMsg = `User cancelled or task resolution failed for QBO Term mapping. TaskId: ${taskResolution.taskId}`;
                        logger.warn(errorMsg, { error: taskResolution.error });
                        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                        return; 
                    }
                    // If task allows updating currentAlgaPaymentTerm or provides qboTermId directly:
                    // currentAlgaPaymentTerm = taskResolution.resolutionData?.updatedAlgaTerm || currentAlgaPaymentTerm;
                    // if (taskResolution.resolutionData?.directQboTermId) { qboCustomerData.SalesTermRef = { value: taskResolution.resolutionData.directQboTermId }; termMappedSuccessfully = true; }
                }
            } catch (mappingError: any) {
                logger.error('Error looking up QBO Term ID', { error: mappingError.message, algaTerm: currentAlgaPaymentTerm, algaCompanyId, tenantId: tenant, realmId });
                setState('MAPPING_ERROR');
                const taskParamsTermLookupError: CreateTaskAndWaitForResultParams = {
                    taskType: 'qbo_sync_error', // Specific task type
                    title: `Error looking up QBO Term for Company ${algaCompany.name}`,
                    description: `API call failed during QBO Term lookup for Alga term: ${currentAlgaPaymentTerm}. Error: ${mappingError.message}. Please check connectivity/config or provide details.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `API call failed during QBO Term lookup for Alga term: ${currentAlgaPaymentTerm}. Error: ${mappingError.message}`,
                        algaCompanyId: algaCompanyId,
                        algaCompanyName: algaCompany.name,
                        currentAlgaTerm: currentAlgaPaymentTerm,
                        realmId: realmId,
                        errorDetails: mappingError,
                        workflow_instance_id: executionId,
                    },
                };
                const taskResolution = await actions.createTaskAndWaitForResult(taskParamsTermLookupError);
                if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                    const errorMsg = `User cancelled or task resolution failed for QBO Term lookup API error. TaskId: ${taskResolution.taskId}`;
                    logger.warn(errorMsg, { error: taskResolution.error });
                    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                    return; 
                }
            }
        }
    }
    data.set('mappedQboCustomerData', qboCustomerData);
    logger.info('Data mapping complete', { algaCompanyId, tenantId: tenant });

    // Fetch QBO Credentials
    let qboCredentials: any; // Will be assigned in the loop
    let qboCredentialsFetchedSuccessfully = false;
    while (!qboCredentialsFetchedSuccessfully) {
        logger.info('Fetching QBO credentials', { realmId, tenantId: tenant, executionId });
        const secretResult = await actions.get_secret({
            secretName: "qbo_credentials",
            scopeIdentifier: realmId,
            tenantId: tenant
        });

        if (!secretResult || !secretResult.success) {
            const errorMessage = secretResult?.message || 'Unknown error fetching QBO credentials.';
            logger.error('Failed to fetch QBO credentials.', { algaCompanyId, realmId, message: errorMessage, errorDetails: secretResult?.errorDetails, tenantId: tenant, executionId });
            setState('QBO_API_ERROR');
            const taskParamsSecretFetchError: CreateTaskAndWaitForResultParams = {
                taskType: 'secret_fetch_error', // Specific task type
                title: `Failed to Fetch QBO Credentials for Company ${algaCompany.name || algaCompanyId}`,
                description: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}. Please ensure credentials are correctly configured or provide them if the task allows.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}`,
                    algaCompanyId: algaCompanyId,
                    realmId: realmId,
                    errorDetails: secretResult?.errorDetails || errorMessage,
                    workflow_instance_id: executionId,
                },
            };
            const taskResolution = await actions.createTaskAndWaitForResult(taskParamsSecretFetchError);
            if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                const errorMsg = `User cancelled or task resolution failed for QBO credentials fetch. TaskId: ${taskResolution.taskId}`;
                logger.warn(errorMsg, { error: taskResolution.error });
                await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                return; 
            }
            // If task allows providing credentials directly, it would be handled here.
        } else {
            qboCredentials = secretResult.secret;
            qboCredentialsFetchedSuccessfully = true;
        }
    }
    if (!qboCredentials) { // Safeguard
        const errorMsg = 'CRITICAL WORKFLOW FAILURE: QBO Credentials null after fetch loop.';
        logger.error(errorMsg, { executionId, tenant, realmId });
        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
        return;
    }
    data.set('qboCredentials', qboCredentials);
    logger.info('QBO credentials fetched and stored successfully', { realmId, tenantId: tenant, executionId });

    // 5. Determine Operation & Execute QBO Action
    let existingQboCustomerId: string | undefined = undefined;
    let qboSyncToken: string | undefined = undefined;
    let mappingCheckedSuccessfully = false;

    while(!mappingCheckedSuccessfully) {
        logger.info('Fetching QBO customer mapping from tenant_external_entity_mappings', { algaCompanyId, realmId, tenantId: tenant });
        const mappingResult = await actions.get_external_entity_mapping({
            algaEntityId: algaCompanyId,
            externalSystemName: 'quickbooks_online',
            externalRealmId: realmId,
        });

        if (mappingResult && mappingResult.success && mappingResult.found && mappingResult.mapping) {
            existingQboCustomerId = mappingResult.mapping.externalEntityId;
            qboSyncToken = mappingResult.mapping.syncToken;
            logger.info('Found existing QBO mapping', { algaCompanyId, existingQboCustomerId, qboSyncToken });
            mappingCheckedSuccessfully = true;
        } else if (mappingResult && !mappingResult.success) {
            logger.error('Failed to fetch QBO customer mapping', { algaCompanyId, error: mappingResult.message, details: mappingResult.errorDetails });
            setState('QBO_API_ERROR');
            const taskParamsMappingLookupError: CreateTaskAndWaitForResultParams = {
                taskType: 'qbo_customer_mapping_lookup_error', // Specific task type
                title: `Failed to lookup QBO mapping for Company ${algaCompany.company_name || algaCompanyId}`,
                description: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}. Please check the mapping system or provide details.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}`,
                    algaCompanyId: algaCompanyId,
                    realmId: realmId,
                    errorDetails: mappingResult.errorDetails || mappingResult.message,
                    workflow_instance_id: executionId,
                },
            };
            const taskResolution = await actions.createTaskAndWaitForResult(taskParamsMappingLookupError);
            if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                const errorMsg = `User cancelled or task resolution failed for QBO mapping lookup. TaskId: ${taskResolution.taskId}`;
                logger.warn(errorMsg, { error: taskResolution.error });
                await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                return; 
            }
        } else { // No mapping found, which is a valid path for create
            logger.info('No existing QBO mapping found for company.', { algaCompanyId });
            mappingCheckedSuccessfully = true; // Proceed to create path
        }
    }
    
    // Main QBO operation loop (Create/Update)
    let qboOperationSuccessful = false;
    while(!qboOperationSuccessful) {
        try {
            let qboResult: QboCustomerResult;

            if (existingQboCustomerId) {
                // --- UPDATE PATH ---
                setState('CALLING_QBO_UPDATE');
                logger.info('Calling QBO Update Customer API', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
                
                if (!qboSyncToken) {
                     logger.error('Missing qboSyncToken for QBO Customer update', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
                     setState('QBO_API_ERROR'); 
                     const taskParamsMissingSyncToken: CreateTaskAndWaitForResultParams = {
                         taskType: 'qbo_sync_error', // Specific task type
                         title: `Missing SyncToken for QBO Customer Update - ${algaCompany.name}`,
                         description: `Cannot update QBO Customer ${existingQboCustomerId} because the qbo_sync_token is missing. Please provide the SyncToken or resolve the mapping.`,
                         priority: 'high',
                         assignTo: userId ? { users: [userId] } : undefined,
                         contextData: {
                             workflowInstanceId: executionId,
                             errorCode: "QBO_MISSING_SYNC_TOKEN",
                             errorMessageText: `Cannot update QBO Customer ${existingQboCustomerId} (Alga ID: ${algaCompanyId}) because the QBO sync token is missing.`,
                             entityType: ENTITY_TYPE_CUSTOMER,
                             entityId: algaCompanyId,
                             operation: "Update QBO Customer",
                             realmId: realmId,
                             workflowStateAtError: getCurrentState(),
                             algaCompanyNameForContext: algaCompany.name,
                             qboCustomerIdForContext: existingQboCustomerId
                         },
                     };
                     const taskResolution = await actions.createTaskAndWaitForResult(taskParamsMissingSyncToken);
                     if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                        const errorMsg = `User cancelled or task resolution failed for missing QBO SyncToken. TaskId: ${taskResolution.taskId}`;
                        logger.warn(errorMsg, { error: taskResolution.error });
                        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                        return; 
                     }
                     // Potentially, task resolution provides the new sync token
                     // qboSyncToken = taskResolution.resolutionData?.newSyncToken || qboSyncToken;
                     // Re-fetch mapping to get latest sync token if task implies external update
                     const updatedMappingResult = await actions.get_external_entity_mapping({ algaEntityId: algaCompanyId, externalSystemName: 'quickbooks_online', externalRealmId: realmId });
                     if (updatedMappingResult && updatedMappingResult.success && updatedMappingResult.found && updatedMappingResult.mapping) {
                        qboSyncToken = updatedMappingResult.mapping.syncToken;
                     }
                     continue; // Retry the update operation with potentially new sync token
                }

                qboResult = await actions.update_qbo_customer({ 
                    qboCustomerId: existingQboCustomerId,
                    qboSyncToken: qboSyncToken,
                    qboCustomerData: { ...qboCustomerData, Id: existingQboCustomerId, SyncToken: qboSyncToken },
                    tenantId: tenant,
                    realmId: realmId,
                    qboCredentials: qboCredentials
                });
                logger.info('QBO Update Customer API call successful', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant });

            } else {
                // --- CREATE PATH ---
                let duplicateCheckPassed = false;
                while(!duplicateCheckPassed) {
                    const performDuplicateCheck = true; 
                    if (performDuplicateCheck) {
                        setState('CHECKING_QBO_DUPLICATES');
                        const displayNameForCheck = qboCustomerData.DisplayName;
                        const emailForCheck = qboCustomerData.PrimaryEmailAddr?.Address;

                        if (!displayNameForCheck && !emailForCheck) {
                            logger.warn('Cannot perform QBO duplicate check: both DisplayName and Email are missing. Skipping check.', { algaCompanyId, tenantId: tenant, realmId });
                            duplicateCheckPassed = true; // Skip to create
                            break; 
                        }
                        
                        logger.info('Checking for potential QBO duplicate customers', { displayName: displayNameForCheck, email: emailForCheck, tenantId: tenant, realmId });
                        try {
                            const potentialDuplicatesResult = await actions.get_qbo_customer_by_display_or_email({
                                displayName: displayNameForCheck,
                                email: emailForCheck,
                                tenantId: tenant,
                                realmId: realmId,
                                qboCredentials: qboCredentials
                            });

                            if (!potentialDuplicatesResult.success) {
                                logger.error('Failed to check for QBO duplicate customers (API Error).', { algaCompanyId, message: potentialDuplicatesResult.message, errorDetails: potentialDuplicatesResult.errorDetails, tenantId: tenant, realmId });
                                setState('QBO_API_ERROR');
                                const taskParams: CreateTaskAndWaitForResultParams = {
                                taskType: 'qbo_sync_error',
                                title: `Failed Duplicate Check for ${algaCompany.name}`,
                                description: `The QBO duplicate customer check failed: ${potentialDuplicatesResult.message || 'Unknown error'}. Manual review required.`,
                                priority: 'high',
                                assignTo: userId ? { users: [userId] } : undefined,
                                contextData: {
                                    workflowInstanceId: executionId,
                                    errorCode: "QBO_DUPLICATE_CHECK_API_FAILED",
                                    errorMessageText: potentialDuplicatesResult.message || 'Unknown error during QBO duplicate customer check.',
                                    entityType: ENTITY_TYPE_CUSTOMER,
                                    entityId: algaCompanyId,
                                    operation: "Check QBO Duplicates",
                                    realmId: realmId,
                                    workflowStateAtError: getCurrentState(),
                                    algaCompanyNameForContext: algaCompany.name,
                                    rawErrorDetailsForContext: potentialDuplicatesResult.errorDetails || potentialDuplicatesResult.message,
                                },
                            };
                            const taskResolution = await actions.createTaskAndWaitForResult(taskParams);
                            if (!taskResolution.success || taskResolution.resolutionData?.action === 'cancel') {
                                const errorMsg = `User cancelled or task resolution failed for QBO duplicate check API failure. TaskId: ${taskResolution.taskId}`;
                                await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                                return; 
                            }
                            continue; // Retry duplicate check
                            }

                            if (potentialDuplicatesResult.found && potentialDuplicatesResult.customers && potentialDuplicatesResult.customers.length > 0) {
                                logger.warn('Potential QBO duplicate customer(s) found', { /* ... */ });
                                setState('DUPLICATE_CHECK_REQUIRED');
                                const taskParamsDupFound: CreateTaskAndWaitForResultParams = { // Renamed taskParams to avoid conflict
                                    taskType: 'qbo_sync_error', // Consider a more specific taskType like 'resolve_qbo_duplicate_customer'
                                    title: `Potential QBO Customer Duplicate for ${qboCustomerData.DisplayName}`,
                                    description: `A potential duplicate QBO customer was found based on display name or email. Please review and resolve manually.`,
                                    priority: 'medium',
                                    assignTo: userId ? { users: [userId] } : undefined,
                                    contextData: {
                                        workflowInstanceId: executionId,
                                        errorCode: "QBO_POTENTIAL_DUPLICATE_FOUND",
                                        errorMessageText: `Potential QBO duplicate customer(s) found for DisplayName: '${qboCustomerData.DisplayName}' or Email: '${qboCustomerData.PrimaryEmailAddr?.Address}'. Manual review required.`,
                                        entityType: ENTITY_TYPE_CUSTOMER,
                                        entityId: algaCompanyId,
                                        operation: "Check QBO Duplicates",
                                        realmId: realmId,
                                        workflowStateAtError: getCurrentState(),
                                        algaCompanyNameForContext: algaCompany.company_name,
                                        mappedDisplayNameForContext: qboCustomerData.DisplayName,
                                        mappedEmailForContext: qboCustomerData.PrimaryEmailAddr?.Address,
                                        potentialDuplicatesFoundForContext: potentialDuplicatesResult.customers,
                                    },
                                };
                                const taskResolutionDupFound = await actions.createTaskAndWaitForResult(taskParamsDupFound); // Use new name
                                if (!taskResolutionDupFound.success || taskResolutionDupFound.resolutionData?.action === 'cancel') {
                                    const errorMsg = `User cancelled or task resolution failed for potential QBO duplicate. TaskId: ${taskResolutionDupFound.taskId}`;
                                    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                                    return; 
                                }
                                
                                if (taskResolutionDupFound.resolutionData?.proceedWithCreate) {
                                    duplicateCheckPassed = true; // User confirmed to proceed
                                } else if (taskResolutionDupFound.resolutionData?.linkToExistingId) {
                                    const errorMsg = `User opted to link to existing QBO customer ID: ${taskResolutionDupFound.resolutionData.linkToExistingId}. Current sync for company ${algaCompanyId} will not proceed with create/update.`;
                                    logger.info(errorMsg);
                                    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId); // This might be considered a "handled" failure by the calling workflow
                                    return; 
                                }
                                // else, loop will retry duplicate check or user might have fixed data for a new check
                                continue; 
                            } else {
                                logger.info('No potential QBO duplicates found.', { algaCompanyId });
                                duplicateCheckPassed = true;
                            }
                        } catch (dupCheckError: any) {
                             logger.error('Unexpected error during QBO duplicate check invocation', { error: dupCheckError.message, algaCompanyId });
                             setState('QBO_API_ERROR');
                             const taskParamsDupUnhandled: CreateTaskAndWaitForResultParams = { // Renamed taskParams
                                 taskType: 'qbo_sync_error',
                                 title: `Error During QBO Duplicate Check - ${algaCompany.name}`,
                                 description: `The check for duplicate QBO customers failed. Error: ${dupCheckError.message}. Cannot proceed with automatic creation.`,
                                 priority: 'high',
                                 assignTo: userId ? { users: [userId] } : undefined,
                                 contextData: {
                                     workflowInstanceId: executionId,
                                     errorCode: "QBO_DUPLICATE_CHECK_UNEXPECTED_ERROR",
                                     errorMessageText: dupCheckError.message || 'Unexpected error during QBO duplicate customer check.',
                                     entityType: ENTITY_TYPE_CUSTOMER,
                                     entityId: algaCompanyId,
                                     operation: "Check QBO Duplicates",
                                     realmId: realmId,
                                     workflowStateAtError: getCurrentState(),
                                     algaCompanyNameForContext: algaCompany.name, 
                                     rawErrorObjectForContext: dupCheckError, 
                                 },
                             };
                             const taskResolutionDupUnhandled = await actions.createTaskAndWaitForResult(taskParamsDupUnhandled); // Use new name
                             if (!taskResolutionDupUnhandled.success || taskResolutionDupUnhandled.resolutionData?.action === 'cancel') {
                                 const errorMsg = `User cancelled or task resolution failed for unexpected QBO duplicate check error. TaskId: ${taskResolutionDupUnhandled.taskId}`;
                                 await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                                 return; 
                             }
                             continue; // Retry duplicate check
                        }
                    } else { // performDuplicateCheck is false
                        duplicateCheckPassed = true; 
                    }
                } // End of while(!duplicateCheckPassed)

                // Proceed with Create if duplicate check passed (or was skipped)
                setState('CALLING_QBO_CREATE');
                logger.info('Calling QBO Create Customer API', { algaCompanyId, tenantId: tenant, realmId });
                qboResult = await actions.create_qbo_customer({
                    qboCustomerData: qboCustomerData,
                    tenantId: tenant,
                    realmId: realmId,
                    qboCredentials: qboCredentials
                });
                logger.info('QBO Create Customer API call successful', { algaCompanyId, newQboCustomerId: qboResult?.Customer?.Id });
            }

            const newQboCustomerId = qboResult?.Customer?.Id;
            const newQboSyncToken = qboResult?.Customer?.SyncToken;

            if (!newQboCustomerId || !newQboSyncToken) {
                 logger.error('QBO API result missing Customer ID or SyncToken', { qboResult, algaCompanyId });
                 setState('QBO_API_ERROR');
                 const taskParams: CreateTaskAndWaitForResultParams = {
                 taskType: 'qbo_sync_error',
                 title: `Invalid Response from QBO API - ${algaCompany.name}`,
                 description: `The QBO API call succeeded but the response did not contain the expected Customer ID and/or SyncToken.`,
                 priority: 'high',
                 assignTo: userId ? { users: [userId] } : undefined,
                 contextData: {
                     workflowInstanceId: executionId,
                     errorCode: "QBO_INVALID_API_RESPONSE",
                     errorMessageText: `QBO API call for customer (Alga ID: ${algaCompanyId}) succeeded but the response was missing Customer ID or SyncToken.`,
                     entityType: ENTITY_TYPE_CUSTOMER,
                     entityId: algaCompanyId,
                     operation: existingQboCustomerId ? "Update QBO Customer" : "Create QBO Customer",
                     realmId: realmId,
                     workflowStateAtError: getCurrentState(),
                     algaCompanyNameForContext: algaCompany.name,
                     qboApiResponseForContext: qboResult,
                 },
             };
                 const taskResolutionInvalidResp = await actions.createTaskAndWaitForResult(taskParams); // Use new name
                 if (!taskResolutionInvalidResp.success || taskResolutionInvalidResp.resolutionData?.action === 'cancel') {
                     const errorMsg = `User cancelled or task resolution failed for QBO invalid API response. TaskId: ${taskResolutionInvalidResp.taskId}`;
                     await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                     return; 
                 }
                 continue; // Retry QBO operation
            }

            data.set('qboResult', qboResult);

            // Update Alga Company Record
            setState('UPDATING_ALGA');
            // This part should ideally also be in a retry loop if it can fail and be user-corrected
            // For now, assuming it's robust or errors are caught by the outer try-catch
            await actions.update_company_qbo_details({
                companyId: algaCompanyId,
                qboCustomerId: newQboCustomerId,
                qboSyncToken: newQboSyncToken,
                realmId: realmId
            });
            logger.info('Alga Company updated successfully', { algaCompanyId, qboCustomerId: newQboCustomerId });
            
            qboOperationSuccessful = true; // Exit main QBO operation loop

        } catch (error: any) {
            const currentRealmIdForError = triggerEvent?.payload?.realmId || realmId || 'UNKNOWN_REALM';
            const errorMsgForTask = `QBO API call failed: ${error.message}`;
            logger.error('QBO API call failed within operation loop', { error: error.message, currentState: getCurrentState(), algaCompanyId, realmId: currentRealmIdForError });
            setState('QBO_API_ERROR');
            data.set('qboApiErrorDetails', { message: error.message, details: error.response?.data || error.stack || error });

            const taskParamsQBOAPIFailed: CreateTaskAndWaitForResultParams = {
                taskType: 'qbo_sync_error', 
                title: `QBO Customer Sync Failed for ${algaCompany?.name || `ID: ${algaCompanyId}`}`,
                description: errorMsgForTask + " Please check QBO status, connection, or data and retry.",
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    workflowInstanceId: executionId,
                    errorCode: "QBO_API_CALL_FAILED_IN_LOOP",
                    errorMessageText: error.message,
                    entityType: ENTITY_TYPE_CUSTOMER,
                    entityId: algaCompanyId,
                    operation: getCurrentState(), 
                    realmId: currentRealmIdForError,
                    workflowStateAtError: getCurrentState(),
                    algaCompanyNameForContext: algaCompany?.name,
                    qboCustomerIdAttemptedForContext: existingQboCustomerId,
                    mappedQboDataForContext: data.get('mappedQboCustomerData'),
                    rawErrorObjectForContext: data.get('qboApiErrorDetails'),
                },
            };
            const taskResolutionApiFail = await actions.createTaskAndWaitForResult(taskParamsQBOAPIFailed);
            if (!taskResolutionApiFail.success || taskResolutionApiFail.resolutionData?.action === 'cancel') {
                const finalErrorMsg = `User cancelled or task resolution failed for QBO API call failure. TaskId: ${taskResolutionApiFail.taskId}`;
                logger.warn(finalErrorMsg, { error: taskResolutionApiFail.error });
                await emitFailureEventIfNeeded(finalErrorMsg, algaCompanyId, currentRealmIdForError);
                return; 
            }
            // If task resolved successfully, the loop will retry the QBO operation.
        }
    } // End of while(!qboOperationSuccessful)

    // 7. Final State (if qboOperationSuccessful)
    setState('SYNC_COMPLETE');
    const finalQboResult = data.get<QboCustomerResult>('qboResult');
    const finalQboCustomerId = finalQboResult?.Customer?.Id;
    logger.info('QBO Customer sync successful', { algaCompanyId, qboCustomerId: finalQboCustomerId, tenantId: tenant, executionId });

    if (successEventName && originatingWorkflowInstanceId) {
      const successPayload = {
        originatingWorkflowInstanceId,
        company_id: algaCompanyId,
        qbo_customer_id: finalQboCustomerId,
        realmId: realmId,
        tenantId: tenant,
      };
      logger.info(`Preparing to emit success event: ${successEventName}`, { payload: successPayload, executionId });
      await events.emit(successEventName, successPayload);
      logger.info(`Success event ${successEventName} emitted successfully.`, { payload: successPayload, executionId });
    } else {
      logger.warn(`Success event not emitted. Missing successEventName or originatingWorkflowInstanceId.`, { successEventName, originatingWorkflowInstanceId, executionId });
    }

  } catch (outerError: any) { 
      const errorMsg = `Workflow failed with outer error: ${outerError.message}`;
      logger.error(`Outer catch block entered in qboCustomerSyncWorkflow. Error: ${errorMsg}`, { stack: outerError.stack, currentState: getCurrentState(), algaCompanyId: triggerEvent?.payload?.company_id, tenantId: tenant, executionId });
      if (getCurrentState() !== 'MAPPING_ERROR' && getCurrentState() !== 'INITIAL') { 
          setState('QBO_API_ERROR'); 
      }
      await emitFailureEventIfNeeded(errorMsg, triggerEvent?.payload?.company_id, triggerEvent?.payload?.realmId);
  }
} // End workflow function
