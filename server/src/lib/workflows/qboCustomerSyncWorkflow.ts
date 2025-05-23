import { WorkflowContext, CreateTaskAndWaitForResultParams, CreateTaskAndWaitForResultReturn } from '../../../../shared/workflow/core';

// Define WorkflowState as a simple object instead of an enum for better portability during transpilation
const WorkflowState = {
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED'
};

// --- BEGIN INLINE FORM TYPES ---
interface AlgaCompanyInfo {
  alga_company_id: string;
  company_name: string;
  primary_address_full_string: string;
  main_phone_number?: string;
  main_email_address?: string;
  website_url?: string;
  date_created_in_alga: string;
  last_modified_in_alga: string;
  current_quickbooks_link_status: string;
  // The following fields were part of the old `AlgaCompany = any` mapping,
  // they are not in AlgaCompanyInfo from the project doc.
  // Keeping them here for context during transition, but they should be reviewed.
  email?: string; // old field, replaced by main_email_address
  phone?: string; // old field, replaced by main_phone_number
  billingAddress?: any; // old field, AlgaCompanyInfo has no structured address
  shippingAddress?: any; // old field, AlgaCompanyInfo has no structured address
  paymentTerm?: string; // This was used for QBO Term ID lookup
}

interface QuickBooksCompanyInfo {
  quickbooks_company_id: string; // QBO Id
  Id?: string; // QBO Id can also be 'Id'
  SyncToken?: string; // QBO SyncToken
  company_name: string; // QBO DisplayName
  DisplayName?: string; // QBO DisplayName
  primary_address_street: string;
  primary_address_city: string;
  primary_address_state: string;
  primary_address_zip: string;
  primary_address_country?: string;
  main_phone_number?: string;
  main_email_address?: string;
  website_url?: string;
  // QBO specific raw fields that might be returned by APIs before normalization
  PrimaryPhone?: { FreeFormNumber?: string };
  PrimaryEmailAddr?: { Address?: string };
  // Add other fields from QBO Customer if needed for display or logic
}

interface ConflictResolutionFormData {
  resolution_action: 'LINK_TO_EXISTING_QB' | 'CREATE_NEW_IN_QB';
  alga_company_id_resolved: string;
  quickbooks_company_id_linked?: string;
  user_notes?: string;
}

interface ContextDataForForm {
  alga_company_id: string;
  company_name: string;
  alga_primary_address_street: string;
  alga_primary_address_city: string;
  alga_primary_address_state: string;
  alga_primary_address_zip: string;
  main_phone_number?: string;
  main_email_address?: string;
  website_url?: string;
  date_created_in_alga: string;
  last_modified_in_alga: string;
  current_quickbooks_link_status: string;
  alga_primary_address_full_string_display: string;
  potentialQuickBooksMatches: QuickBooksCompanyInfo[]; // Changed from qb_company_name etc. to array
  sync_job_id: string;
  conflict_detection_timestamp: string;
  // Fields for JSON schema templating (derived from potentialQuickBooksMatches)
  qb_company_name?: string;
  qb_primary_address_street?: string;
  qb_primary_address_city?: string;
  qb_primary_address_state?: string;
  qb_primary_address_zip?: string;
  qb_main_phone_number?: string;
  qb_main_email_address?: string;
  qb_website_url?: string;
  quickbooks_company_id_options?: { label: string; value: string }[];
  qbDetailedDisplayInfo?: string; // New field for pre-formatted QB display
}

interface InlineTaskResolutionReturn extends CreateTaskAndWaitForResultReturn {
  status?: 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'EXPIRED'; // From project doc
  resolutionData?: ConflictResolutionFormData; // Specific resolution data
}

// --- END INLINE FORM TYPES ---

// Define placeholder types if real ones are not available yet
type AlgaCompany = AlgaCompanyInfo; // Use the new specific type
type QboCustomerInput = any; // Keep as any for now, QBO SDK might have proper types
type QboCustomerResult = any; // Keep as any for now
type HumanTaskInput = any; // Unused in this snippet focus
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

/**
 * Workflow to synchronize Alga PSA Company data to QuickBooks Online Customer.
 * Triggered by COMPANY_CREATED or COMPANY_UPDATED events.
 */
export async function qboCustomerSyncWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger, setState, getCurrentState, tenant, executionId, userId } = context;

  const ENTITY_TYPE_CUSTOMER = "Customer";

  // 1. Initialization & State
  setState(WorkflowState.RUNNING);
  logger.info('QBO Customer Sync workflow started', { tenantId: tenant, executionId });

  // 2. Trigger Event & Context
  let triggerEvent = data.get<TriggerEvent>('triggerEvent'); // Initial fetch from context.data

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

  let realmId = triggerEvent.payload.realmId;
  let algaCompanyId = triggerEvent.payload.company_id;
  const originatingWorkflowInstanceId = triggerEvent.payload.originatingWorkflowInstanceId;
  const successEventName = triggerEvent.payload.successEventName;
  const failureEventName = triggerEvent.payload.failureEventName; // Already captured for emitFailureEventIfNeeded

  logger.info('Processing trigger event payload', { eventName: triggerEvent.name, realmId, algaCompanyId, originatingWorkflowInstanceId, successEventName, failureEventName, tenantId: tenant, executionId });


  if (!realmId || !algaCompanyId) {
    const errorMsg = 'CRITICAL WORKFLOW FAILURE: Missing realm id or company id.';
    logger.error(errorMsg);
    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
    return;
  }


  try {
    // 3. Data Fetching
    setState(WorkflowState.RUNNING);
    logger.info('Fetching Alga Company data', { algaCompanyId, tenantId: tenant });
    
    let algaCompany: AlgaCompanyInfo | null = null; // Initialize to null
    let algaCompanyFetchedSuccessfully = false;
    while (!algaCompanyFetchedSuccessfully) {
        const fetchedCompany: AlgaCompanyInfo | null = await actions.getCompany({ id: algaCompanyId, tenantId: tenant });
        if (!fetchedCompany) {
            logger.error('Alga Company not found', { algaCompanyId, tenantId: tenant });
            setState(WorkflowState.ERROR);
            const taskParamsCompanyNotFound: CreateTaskAndWaitForResultParams = {
                taskType: 'workflow_error',
                title: 'Workflow Data Error: Alga Company Not Found',
                description: `Could not fetch Alga Company data for ID: ${algaCompanyId}. Please ensure the company exists and is accessible, or provide corrected information if applicable.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `Could not fetch Alga Company data for ID: ${algaCompanyId}. The company may not exist or there was an issue with the data fetching action.`,
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
            algaCompany = fetchedCompany; // fetchedCompany is AlgaCompanyInfo | null
            algaCompanyFetchedSuccessfully = true;
        }
    }

    if (!algaCompany) {
        const errorMsg = 'CRITICAL WORKFLOW FAILURE: AlgaCompany is null after fetch loop (company not found or other issue).';
        logger.error(errorMsg, { executionId, tenant, algaCompanyId });
        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
        return; 
    }

    data.set('algaCompany', algaCompany);
    logger.info('Alga Company data fetched successfully', { algaCompanyId, tenantId: tenant });

    // 4. Data Mapping
    setState(WorkflowState.RUNNING);
    logger.info('Mapping Alga Company data to QBO Customer format', { algaCompanyId, tenantId: tenant });

    // Fetch company location data for real address information
    let defaultLocation: any = null;
    try {
        const locationResult = await actions.get_company_default_location({ companyId: algaCompanyId });
        if (locationResult.success && locationResult.found && locationResult.location) {
            defaultLocation = locationResult.location;
            logger.info('Successfully fetched company default location', { algaCompanyId, locationId: defaultLocation.location_id });
        } else {
            logger.warn('No default location found for company', { algaCompanyId, message: locationResult.message });
        }
    } catch (locationError: any) {
        logger.error('Error fetching company location', { error: locationError.message, algaCompanyId });
        // Continue without location data rather than failing the entire workflow
    }

    // Build address objects using real location data or fallback to placeholders
    const buildAddress = (location: any) => {
        if (location) {
            return {
                Line1: location.address_line1 || '',
                Line2: location.address_line2 || undefined,
                Line3: location.address_line3 || undefined,
                City: location.city || '',
                CountrySubDivisionCode: location.state_province || '',
                PostalCode: location.postal_code || '',
                Country: location.country_name || location.country_code || '',
            };
        } else {
            return {
                Line1: "Address not available",
                City: "N/A",
                CountrySubDivisionCode: "N/A",
                PostalCode: "N/A",
                Country: "N/A",
            };
        }
    };

    // TODO: Refine mapping based on actual AlgaCompany and QboCustomer types
    const qboCustomerData: QboCustomerInput = {
        DisplayName: algaCompany!.company_name, // algaCompany is verified not null by the check above
        PrimaryEmailAddr: { Address: algaCompany!.main_email_address },
        PrimaryPhone: { FreeFormNumber: algaCompany!.main_phone_number },
        BillAddr: buildAddress(defaultLocation),
        ShipAddr: buildAddress(defaultLocation), // Using same address for both billing and shipping by default
        // Add other relevant fields: Notes, WebAddr, etc.
    };

    // Map Payment Terms
    // TODO: Review algaCompany.paymentTerm, as AlgaCompanyInfo from project doc does not list it.
    // Assuming it might still be part of the object returned by actions.getCompany or needs to be added to AlgaCompanyInfo.
    if ((algaCompany as any)?.paymentTerm) { // Added optional chaining for algaCompany itself
        let termMappedSuccessfully = false;
        let currentAlgaPaymentTerm = (algaCompany as any).paymentTerm; // Use a variable that might be updated by task

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
                    setState(WorkflowState.ERROR);
                    const taskParamsTermMappingMissing: CreateTaskAndWaitForResultParams = {
                        taskType: 'qbo_mapping_error', // Specific task type
                        title: `QBO Term Mapping Missing for Company ${algaCompany!.company_name}`,
                        description: `Could not find a corresponding QBO Term for Alga term: ${currentAlgaPaymentTerm}. Please ensure the mapping exists or provide the correct Alga term/QBO Term ID.`,
                        priority: 'medium',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `Could not find a corresponding QBO Term for Alga term: ${currentAlgaPaymentTerm}`,
                            algaCompanyId: algaCompanyId,
                            algaCompanyName: algaCompany!.company_name,
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
                setState(WorkflowState.ERROR);
                const taskParamsTermLookupError: CreateTaskAndWaitForResultParams = {
                    taskType: 'workflow_error',
                    title: `Error looking up QBO Term for Company ${algaCompany!.company_name}`,
                    description: `API call failed during QBO Term lookup for Alga term: ${currentAlgaPaymentTerm}. Error: ${mappingError.message}. Please check connectivity/config or provide details.`,
                    priority: 'high',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `API call failed during QBO Term lookup for Alga term: ${currentAlgaPaymentTerm}. Error: ${mappingError.message}`,
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
            setState(WorkflowState.ERROR);
            const taskParamsSecretFetchError: CreateTaskAndWaitForResultParams = {
                taskType: 'workflow_error', // Specific task type
                title: `Failed to Fetch QBO Credentials for Company ${algaCompany?.company_name || algaCompanyId}`,
                description: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}. Please ensure credentials are correctly configured or provide them if the task allows.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}`,
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
            algaEntityType: 'company', // Explicitly specify entity type for clarity
        });

        if (mappingResult && mappingResult.success && mappingResult.found && mappingResult.mapping) {
            existingQboCustomerId = mappingResult.mapping.externalEntityId;
            qboSyncToken = mappingResult.mapping.syncToken;
            logger.info('Found existing QBO mapping', { algaCompanyId, existingQboCustomerId, qboSyncToken });
            mappingCheckedSuccessfully = true;
        } else if (mappingResult && !mappingResult.success) {
            logger.error('Failed to fetch QBO customer mapping', { algaCompanyId, error: mappingResult.message, details: mappingResult.errorDetails });
            setState(WorkflowState.ERROR);
            const taskParamsMappingLookupError: CreateTaskAndWaitForResultParams = {
                taskType: 'workflow_error', // Specific task type
                title: `Failed to lookup QBO mapping for Company ${algaCompany?.company_name || algaCompanyId}`,
                description: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}. Please check the mapping system or provide details.`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}`,
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
    
    let userChoseToLinkAndNeedsDirectFetch = false; // Flag for direct fetch after user links
    // Main QBO operation loop (Create/Update)
    let qboOperationSuccessful = false;
    while(!qboOperationSuccessful) {
        try {
            let qboResult: QboCustomerResult;
            let decidedToLinkViaForm = false; // Flag to indicate if user chose to link via the inline form

            if (existingQboCustomerId) {
                // --- UPDATE PATH ---
                setState(WorkflowState.RUNNING);
                logger.info('Calling QBO Update Customer API', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
                
                if (!qboSyncToken) {
                    // Check if user chose to link and a direct fetch is needed
                    if (userChoseToLinkAndNeedsDirectFetch) {
                        try {
                            logger.info('Attempting direct QBO customer fetch due to user link choice.', { qboCustomerId: existingQboCustomerId, realmId, tenantId: tenant });
                            const qboCustomerDetailsResult = await actions.get_qbo_customer_by_id({
                                qboCustomerId: existingQboCustomerId!, // existingQboCustomerId is confirmed to be non-null in this path
                                realmId: realmId,
                                qboCredentials: qboCredentials,
                                // tenantId is implicitly passed by context to actions
                            });

                            if (qboCustomerDetailsResult && qboCustomerDetailsResult.success && qboCustomerDetailsResult.customer?.SyncToken) {
                                qboSyncToken = qboCustomerDetailsResult.customer.SyncToken;
                                logger.info('Successfully fetched SyncToken via direct QBO customer fetch.', { qboCustomerId: existingQboCustomerId, newSyncToken: qboSyncToken });
                                // Optional: If qboCustomerDetailsResult.customer contains other relevant fields,
                                // we should consider merging them into qboCustomerData carefully,
                                // ensuring Alga-sourced data intended for the update is prioritized.
                                // For now, primarily focus on getting the SyncToken.
                            } else {
                                logger.warn('Failed to fetch QBO customer details or SyncToken directly after user link choice. Will proceed to standard missing SyncToken logic.', { qboCustomerId: existingQboCustomerId, resultMessage: qboCustomerDetailsResult?.message, success: qboCustomerDetailsResult?.success });
                            }
                        } catch (directFetchError: any) {
                            logger.error('Error during direct fetch of QBO customer after user link choice.', { qboCustomerId: existingQboCustomerId, error: directFetchError.message });
                            // Let it fall through to the standard missing SyncToken logic
                        }
                        userChoseToLinkAndNeedsDirectFetch = false; // Reset the flag after this attempt, regardless of outcome.
                    }

                    // If SyncToken is still missing after the potential direct fetch, proceed with existing error handling
                    if (!qboSyncToken) {
                         logger.error('Missing qboSyncToken for QBO Customer update (after direct fetch attempt if applicable).', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
                         setState(WorkflowState.ERROR);
                         const taskParamsMissingSyncToken: CreateTaskAndWaitForResultParams = {
                             taskType: 'workflow_error', // Specific task type
                             title: `Missing SyncToken for QBO Customer Update - ${algaCompany!.company_name}`,
                             description: `SyncToken for linked QBO customer ${existingQboCustomerId} could not be obtained automatically after user choice. Please verify and provide.`, // Adjusted description
                             priority: 'high',
                             assignTo: userId ? { users: [userId] } : undefined,
                             contextData: {
                                 message: `Cannot update QBO Customer ${existingQboCustomerId} (Alga ID: ${algaCompanyId}) because the QBO sync token is missing (after direct fetch attempt if user linked).`, // Adjusted message
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
                         const updatedMappingResult = await actions.get_external_entity_mapping({
                             algaEntityId: algaCompanyId,
                             externalSystemName: 'quickbooks_online',
                             externalRealmId: realmId,
                             algaEntityType: 'company' // Explicitly specify entity type for clarity
                         });
                         if (updatedMappingResult && updatedMappingResult.success && updatedMappingResult.found && updatedMappingResult.mapping) {
                            qboSyncToken = updatedMappingResult.mapping.syncToken;
                         }
                         continue; // Retry the update operation with potentially new sync token
                    }
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
                // decidedToLinkViaForm is now declared at a higher scope
                let duplicateCheckPassed = false;
                while(!duplicateCheckPassed) {
                    const performDuplicateCheck = true; 
                    if (performDuplicateCheck) {
                        setState(WorkflowState.RUNNING);
                        const displayNameForCheck = qboCustomerData.DisplayName;
                        const emailForCheck = qboCustomerData.PrimaryEmailAddr?.Address;

                        if (!displayNameForCheck && !emailForCheck) {
                            logger.warn('Cannot perform QBO duplicate check: both DisplayName and Email are missing. Skipping check.', { algaCompanyId, tenantId: tenant, realmId });
                            duplicateCheckPassed = true; // Skip to create
                            break; 
                        }
                        
                        logger.info('Checking for potential QBO duplicate customers', { displayName: displayNameForCheck, email: emailForCheck, tenantId: tenant, realmId });
                        try {
                            // Cast potentialDuplicatesResult.customers to QuickBooksCompanyInfo[]
                            const potentialDuplicatesResult = await actions.get_qbo_customer_by_display_or_email({
                                displayName: displayNameForCheck,
                                email: emailForCheck,
                                tenantId: tenant,
                                realmId: realmId,
                                qboCredentials: qboCredentials
                            }) as { success: boolean; found: boolean; customers?: QuickBooksCompanyInfo[]; message?: string; errorDetails?: any; };


                            if (!potentialDuplicatesResult.success) {
                                logger.error('Failed to check for QBO duplicate customers (API Error).', { algaCompanyId, message: potentialDuplicatesResult.message, errorDetails: potentialDuplicatesResult.errorDetails, tenantId: tenant, realmId });
                                setState(WorkflowState.ERROR);
                                const taskParams: CreateTaskAndWaitForResultParams = {
                                taskType: 'workflow_error',
                                title: `Failed Duplicate Check for ${algaCompany!.company_name}`,
                                description: `The QBO duplicate customer check failed: ${potentialDuplicatesResult.message || 'Unknown error'}. Manual review required.`,
                                priority: 'high',
                                assignTo: userId ? { users: [userId] } : undefined,
                                contextData: {
                                    message: potentialDuplicatesResult.message || 'Unknown error during QBO duplicate customer check.',
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
                                logger.warn('Potential QBO duplicate customer(s) found', { algaCompanyId, count: potentialDuplicatesResult.customers.length });
                                setState(WorkflowState.RUNNING); // Set to RUNNING as we are creating an inline task

                                // --- BEGIN INLINE FORM FOR COMPANY CONFLICT ---
                                const primaryQbMatch = potentialDuplicatesResult.customers[0]; // For single display, form schema handles multiple options

                                const contextDataForForm: ContextDataForForm = {
                                    alga_company_id: algaCompany!.alga_company_id,
                                    company_name: algaCompany!.company_name,
                                    alga_primary_address_street: defaultLocation?.address_line1 || "Address not available",
                                    alga_primary_address_city: defaultLocation?.city || "N/A",
                                    alga_primary_address_state: defaultLocation?.state_province || "N/A",
                                    alga_primary_address_zip: defaultLocation?.postal_code || "N/A",
                                    main_phone_number: algaCompany!.main_phone_number,
                                    main_email_address: algaCompany!.main_email_address,
                                    website_url: algaCompany!.website_url,
                                    date_created_in_alga: algaCompany!.date_created_in_alga,
                                    last_modified_in_alga: algaCompany!.last_modified_in_alga,
                                    current_quickbooks_link_status: algaCompany!.current_quickbooks_link_status,
                                    alga_primary_address_full_string_display: defaultLocation 
                                        ? `${defaultLocation.address_line1}${defaultLocation.address_line2 ? ', ' + defaultLocation.address_line2 : ''}${defaultLocation.address_line3 ? ', ' + defaultLocation.address_line3 : ''}, ${defaultLocation.city}, ${defaultLocation.state_province || ''} ${defaultLocation.postal_code || ''}, ${defaultLocation.country_name || defaultLocation.country_code || ''}`
                                        : algaCompany!.primary_address_full_string || "Address not available",
                                    potentialQuickBooksMatches: potentialDuplicatesResult.customers || [], // Ensure it's an array
                                    sync_job_id: executionId,
                                    conflict_detection_timestamp: new Date().toISOString(),
                                    // For schema templating, provide first match details if any
                                    qb_company_name: primaryQbMatch?.DisplayName || primaryQbMatch?.company_name,
                                    qb_primary_address_street: primaryQbMatch?.primary_address_street,
                                    qb_primary_address_city: primaryQbMatch?.primary_address_city,
                                    qb_primary_address_state: primaryQbMatch?.primary_address_state,
                                    qb_primary_address_zip: primaryQbMatch?.primary_address_zip,
                                    qb_main_phone_number: primaryQbMatch?.main_phone_number || primaryQbMatch?.PrimaryPhone?.FreeFormNumber,
                                    qb_main_email_address: primaryQbMatch?.main_email_address || primaryQbMatch?.PrimaryEmailAddr?.Address,
                                    qb_website_url: primaryQbMatch?.website_url,
                                    quickbooks_company_id_options: (potentialDuplicatesResult.customers || []).map(qb => ({
                                        label: `${qb.DisplayName || qb.company_name} (ID: ${qb.Id || qb.quickbooks_company_id}, Addr: ${qb.primary_address_street || ''}, ${qb.primary_address_city || ''})`,
                                        value: qb.Id || qb.quickbooks_company_id
                                    })),
                                    // Prepare qbDetailedDisplayInfo
                                    qbDetailedDisplayInfo: primaryQbMatch?.DisplayName || primaryQbMatch?.company_name
                                        ? `**QuickBooks Company Name:** ${primaryQbMatch.DisplayName || primaryQbMatch.company_name}\n**QB Address:** ${primaryQbMatch.primary_address_street || ''}, ${primaryQbMatch.primary_address_city || ''}, ${primaryQbMatch.primary_address_state || ''} ${primaryQbMatch.primary_address_zip || ''}\n**QB Phone:** ${primaryQbMatch.main_phone_number || primaryQbMatch.PrimaryPhone?.FreeFormNumber || 'N/A'}\n**QB Email:** ${primaryQbMatch.main_email_address || primaryQbMatch.PrimaryEmailAddr?.Address || 'N/A'}\n**QB Website:** ${primaryQbMatch.website_url || 'N/A'}`
                                        : 'No potential QuickBooks match data available to display.'
                                };

                                // Dynamically construct the JSON schema for the form
                                const finalCompanyConflictJsonSchema = {
                                    "type": "object",
                                    "title": "Resolve Company Sync Conflict",
                                    "properties": {
                                      "conflictContextInfo": { "type": "string", "title": "Conflict Context", "default": "**Sync Job ID:** ${contextData.sync_job_id}\n**Detected on:** ${new Date(contextData.conflict_detection_timestamp).toLocaleString()}", "readOnly": true },
                                      "algaCompanyDisplay": { "type": "string", "title": "Alga Company Information (Our System)", "default": "**Alga Company ID:** ${contextData.alga_company_id}\n**Company Name:** ${contextData.company_name}\n**Primary Address:** ${contextData.alga_primary_address_full_string_display}\n**Address Details:** ${contextData.alga_primary_address_street}, ${contextData.alga_primary_address_city}, ${contextData.alga_primary_address_state} ${contextData.alga_primary_address_zip}\n**Main Phone:** ${contextData.main_phone_number || 'N/A'}\n**Main Email:** ${contextData.main_email_address || 'N/A'}\n**Website:** ${contextData.website_url || 'N/A'}\n**Created in Alga:** ${new Date(contextData.date_created_in_alga).toLocaleDateString()}\n**Last Modified in Alga:** ${new Date(contextData.last_modified_in_alga).toLocaleDateString()}\n**Current QuickBooks Link Status:** ${contextData.current_quickbooks_link_status}", "readOnly": true },
                                      "quickbooksCompanyDisplay": { "type": "string", "title": "Potential QuickBooks Match Information", "default": "${contextData.qbDetailedDisplayInfo}", "readOnly": true },
                                      "resolution_action": {
                                        "type": "string",
                                        "title": "Select Resolution Action",
                                        "oneOf": [
                                          {
                                            "const": "LINK_TO_EXISTING_QB",
                                            "title": "Link Alga company to this existing QuickBooks company"
                                          },
                                          {
                                            "const": "CREATE_NEW_IN_QB",
                                            "title": "Create this Alga company as a new company in QuickBooks"
                                          }
                                        ]
                                      },
                                      "alga_company_id_resolved": { "type": "string", "default": "${contextData.alga_company_id}" },
                                      "quickbooks_company_id_linked": {
                                        "type": "string",
                                        "title": "Select QuickBooks Company to Link",
                                        "oneOf": (contextDataForForm.quickbooks_company_id_options && contextDataForForm.quickbooks_company_id_options.length > 0
                                                  ? contextDataForForm.quickbooks_company_id_options.map(opt => ({'const': opt.value, 'title': opt.label}))
                                                  : [{ 'const': '', 'title': 'No QuickBooks companies available to link'}])
                                      },
                                    },
                                    "required": ["resolution_action", "alga_company_id_resolved"],
                                    "dependencies": { "resolution_action": { "oneOf": [ { "properties": { "resolution_action": { "const": "LINK_TO_EXISTING_QB" } }, "required": ["quickbooks_company_id_linked"] }, {  "properties": { "resolution_action": { "const": "CREATE_NEW_IN_QB" } } } ] } }
                                  };
                                
                                const companyConflictUiSchema = {
                                    "ui:order": ["conflictContextInfo", "algaCompanyDisplay", "quickbooksCompanyDisplay", "resolution_action", "quickbooks_company_id_linked", "user_notes", "alga_company_id_resolved"],
                                    "conflictContextInfo": { "ui:widget": "RichTextViewerWidget" },
                                    "algaCompanyDisplay": { "ui:widget": "RichTextViewerWidget" },
                                    "quickbooksCompanyDisplay": { "ui:widget": "RichTextViewerWidget", "ui:visible": "${contextData.qb_company_name != null}" },
                                    "alga_company_id_resolved": { "ui:widget": "hidden" },
                                    "resolution_action": { "ui:widget": "radio" },
                                    "quickbooks_company_id_linked": { "ui:placeholder": "Choose a QuickBooks company", "ui:visible": "${formData.resolution_action === 'LINK_TO_EXISTING_QB'}" },
                                  };

                                const inlineTaskParams = {
                                    workflowContext: context, // Pass the whole context if needed by the action
                                    taskDefinitionId: "companyConflictResolutionForm_v5",
                                    title: `Resolve Company Conflict: ${algaCompany!.company_name}`,
                                    description: `Potential QuickBooks duplicate(s) found for ${algaCompany!.company_name}. Please review and choose an action.`,
                                    assignTo: { users: userId ? [userId] : undefined }, // from workflow context
                                    contextData: contextDataForForm,
                                    form: {
                                        jsonSchema: finalCompanyConflictJsonSchema, // Use the dynamically constructed schema
                                        uiSchema: companyConflictUiSchema,
                                    },
                                    priority: 'high',
                                    // timeoutSeconds: 3600 // Optional
                                };
                                
                                // Assuming actions.createInlineTaskAndWaitForResult exists and returns InlineTaskResolutionReturn
                                const taskResolution: InlineTaskResolutionReturn = await (actions as any).createInlineTaskAndWaitForResult(inlineTaskParams);

                                if (!taskResolution.success || !taskResolution.resolutionData) {
                                    const errorMsg = `Company conflict resolution task was cancelled or failed. TaskId: ${taskResolution.taskId}, Status: ${taskResolution.status}, Error: ${taskResolution.error}`;
                                    logger.warn(errorMsg, { algaCompanyId, realmId, executionId });
                                    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                                    return;
                                }

                                const resolutionData = taskResolution.resolutionData;
                                console.log('Task resolution data:', resolutionData);
                                if (resolutionData.resolution_action === 'LINK_TO_EXISTING_QB' && resolutionData.quickbooks_company_id_linked) {
                                    existingQboCustomerId = resolutionData.quickbooks_company_id_linked;
                                    qboSyncToken = undefined; // Force re-fetch of SyncToken in the UPDATE path
                                    userChoseToLinkAndNeedsDirectFetch = true;
                                    decidedToLinkViaForm = true; // Set flag
                                    logger.info(`User chose to link Alga company ${algaCompanyId} to existing QBO customer ${existingQboCustomerId}. Proceeding to update.`, { algaCompanyId, existingQboCustomerId, executionId });
                                    duplicateCheckPassed = true; // Exit duplicate check loop
                                } else if (resolutionData.resolution_action === 'CREATE_NEW_IN_QB') {
                                    logger.info(`User chose to create a new QBO customer for Alga company ${algaCompanyId}. Proceeding to create.`, { algaCompanyId, executionId });
                                    duplicateCheckPassed = true; // Proceed to create
                                } else {
                                    // Should not happen if form validation is correct
                                    const errorMsg = `Invalid resolution action from company conflict form: ${resolutionData.resolution_action}. TaskId: ${taskResolution.taskId}`;
                                    logger.error(errorMsg, { algaCompanyId, realmId, executionId });
                                    await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                                    return;
                                }
                                // --- END INLINE FORM FOR COMPANY CONFLICT ---
                                continue; // Continue the while(!duplicateCheckPassed) loop. If duplicateCheckPassed is true, it will exit.
                            } else {
                                logger.info('No potential QBO duplicates found.', { algaCompanyId });
                                duplicateCheckPassed = true;
                            }
                        } catch (dupCheckError: any) {
                             logger.error('Unexpected error during QBO duplicate check invocation', { error: dupCheckError.message, algaCompanyId });
                             setState(WorkflowState.ERROR); // Keep ERROR state
                             const taskParamsDupUnhandled: CreateTaskAndWaitForResultParams = {
                                 taskType: 'workflow_error',
                                 title: `Error During QBO Duplicate Check - ${algaCompany!.company_name}`,
                                 description: `The check for duplicate QBO customers failed. Error: ${dupCheckError.message}. Cannot proceed with automatic creation.`,
                                 priority: 'high',
                                 assignTo: userId ? { users: [userId] } : undefined,
                                 contextData: {
                                     message: dupCheckError.message || 'Unexpected error during QBO duplicate customer check.',
                                 },
                             };
                             const taskResolutionDupUnhandled = await actions.createTaskAndWaitForResult(taskParamsDupUnhandled);
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

                // After duplicate check loop, if user decided to link via form,
                // existingQboCustomerId is now set. We should 'continue' the main qboOperationSuccessful loop
                // to go through the UPDATE PATH.
                if (decidedToLinkViaForm) {
                    logger.info('User linked via form, re-evaluating main QBO operation loop for UPDATE.', { existingQboCustomerId });
                    continue; // Restart the while(!qboOperationSuccessful) loop
                }

                // Only proceed to create if existingQboCustomerId was NOT set by the inline form
                // (i.e., user chose to create new, or no conflict was found, or duplicate check was skipped)
                // AND existingQboCustomerId was not set from the initial mapping check.
                // The `decidedToLinkViaForm` check above handles the case where it was set by the form.
                // So, if we reach here, `existingQboCustomerId` is truly null (or was never set by form to link).
                
                // This 'else' corresponds to the `if (existingQboCustomerId)` at the start of the try block (line 416)
                // It means we are on the "CREATE" path because no existingQboCustomerId was found initially.
                setState(WorkflowState.RUNNING);
                logger.info('Calling QBO Create Customer API', { algaCompanyId, tenantId: tenant, realmId });
                qboResult = await actions.create_qbo_customer({
                    qboCustomerData: qboCustomerData,
                    tenantId: tenant,
                    realmId: realmId,
                    qboCredentials: qboCredentials
                });
                logger.info('QBO Create Customer API call successful', { algaCompanyId, newQboCustomerId: qboResult?.Customer?.Id });
            } // End of if/else for UPDATE/CREATE main paths


            // This part executes if either CREATE or UPDATE was successful IN THIS ITERATION and produced a qboResult.
            // If we `continue`d above due to `decidedToLinkViaForm`, qboResult would be undefined here,
            // and this block should effectively be skipped for this iteration.
            // The `qboResult` check handles this.
            if (qboResult) { // Only process if qboResult is defined (i.e., an operation was performed in this iteration)
                const newQboCustomerId = qboResult.Customer?.Id;
                const newQboSyncToken = qboResult.Customer?.SyncToken;

                if (!newQboCustomerId || !newQboSyncToken) {
                    logger.error('QBO API result missing Customer ID or SyncToken', { qboResult, algaCompanyId });
                    setState(WorkflowState.ERROR);
                    const taskParams: CreateTaskAndWaitForResultParams = {
                        taskType: 'workflow_error',
                        title: `Invalid Response from QBO API - ${algaCompany!.company_name}`,
                        description: `The QBO API call succeeded but the response did not contain the expected Customer ID and/or SyncToken.`,
                        priority: 'high',
                        assignTo: userId ? { users: [userId] } : undefined,
                        contextData: {
                            message: `QBO API call for customer (Alga ID: ${algaCompanyId}) succeeded but the response was missing Customer ID or SyncToken.`,
                        },
                    };
                    const taskResolutionInvalidResp = await actions.createTaskAndWaitForResult(taskParams);
                    if (!taskResolutionInvalidResp.success || taskResolutionInvalidResp.resolutionData?.action === 'cancel') {
                        const errorMsg = `User cancelled or task resolution failed for QBO invalid API response. TaskId: ${taskResolutionInvalidResp.taskId}`;
                        await emitFailureEventIfNeeded(errorMsg, algaCompanyId, realmId);
                        return;
                    }
                    continue; // Retry QBO operation
                }

                data.set('qboResult', qboResult);

                // Update Alga Company Record
                setState(WorkflowState.RUNNING);
                await actions.update_company_qbo_details({
                    companyId: algaCompanyId,
                    qboCustomerId: newQboCustomerId,
                    qboSyncToken: newQboSyncToken,
                    realmId: realmId
                });
                logger.info('Alga Company updated successfully', { algaCompanyId, qboCustomerId: newQboCustomerId });
                
                qboOperationSuccessful = true; // Exit main QBO operation loop
            } else if (!existingQboCustomerId && !decidedToLinkViaForm) {
                // This case should ideally not be reached if create path was intended and failed to produce qboResult before this check.
                // However, as a safeguard if qboResult is unexpectedly undefined after an intended create.
                logger.error('qboResult is undefined after create path and not due to form link. This indicates an issue.', { algaCompanyId });
                // Potentially throw or create a task here if this state is considered an unrecoverable error for the create path.
                // For now, let it retry the QBO operation.
                continue;
            }
            // If decidedToLinkViaForm was true, we would have `continue`d the outer loop already,
            // and qboResult would be undefined, so the `if (qboResult)` block above is skipped.
            // The next iteration will then handle the UPDATE.

        } catch (error: any) {
            const currentRealmIdForError = triggerEvent?.payload?.realmId || realmId || 'UNKNOWN_REALM';
            const errorMsgForTask = `QBO API call failed: ${error.message}`;
            logger.error('QBO API call failed within operation loop', { error: error.message, currentState: getCurrentState(), algaCompanyId, realmId: currentRealmIdForError });
            setState(WorkflowState.ERROR);
            data.set('qboApiErrorDetails', { message: error.message, details: error.response?.data || error.stack || error });

            const taskParamsQBOAPIFailed: CreateTaskAndWaitForResultParams = {
                taskType: 'workflow_error',
                title: `QBO Customer Sync Failed for ${algaCompany?.company_name || `ID: ${algaCompanyId}`}`,
                description: errorMsgForTask + " Please check QBO status, connection, or data and retry.",
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: error.message,
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
    setState(WorkflowState.COMPLETE);
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
      if (getCurrentState() !== WorkflowState.ERROR) { 
          setState(WorkflowState.ERROR); 
      }
      await emitFailureEventIfNeeded(errorMsg, triggerEvent?.payload?.company_id, triggerEvent?.payload?.realmId);
  }
} // End workflow function
