import { WorkflowContext } from '../../../../shared/workflow/core';
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
  // TODO: Confirm other potential payload fields like trigger type ('COMPANY_CREATED' | 'COMPANY_UPDATED')
  originatingWorkflowInstanceId?: string; // Add other fields from actual payload
  tenantId?: string; // Add other fields from actual payload
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
  const triggerEvent = data.get<TriggerEvent>('triggerEvent');

  if (!triggerEvent || !triggerEvent.payload) {
      logger.error('Missing triggerEvent or its payload in workflow context data', { tenantId: tenant, executionId, contextData: data.get('triggerEvent') });
      setState('MAPPING_ERROR'); // Or a more specific error state like 'MISSING_INPUT'
      await actions.createHumanTask({
          taskType: 'internal_workflow_error',
          title: 'Workflow Input Error: Missing Trigger Event',
          description: 'The QBO Customer Sync workflow was triggered without a valid triggerEvent or payload.',
          priority: 'high',
          assignTo: userId ? { users: [userId] } : undefined,
          contextData: {
              message: 'The QBO Customer Sync workflow was triggered without a valid triggerEvent or payload. Investigation needed.',
              executionId: executionId,
              tenantId: tenant,
              contextData: data.get('triggerEvent'),
          },
      } as HumanTaskInput);
      return;
  }

  const { realmId, company_id: algaCompanyId } = triggerEvent.payload; // Use company_id and alias to algaCompanyId for consistency below

  logger.info('Processing trigger event payload', { eventName: triggerEvent.name, realmId, algaCompanyId, tenantId: tenant, executionId });

  if (!realmId || !algaCompanyId) {
      logger.error('Missing realmId or algaCompanyId in triggerEvent payload', { payload: triggerEvent.payload, tenantId: tenant, executionId });
      setState('MAPPING_ERROR'); // Or a more specific error state
      await actions.createHumanTask({
          taskType: 'internal_workflow_error',
          title: 'Workflow Input Error: Missing Critical IDs',
          description: 'The QBO Customer Sync workflow was triggered without realmId or algaCompanyId in the payload.',
          priority: 'high',
          assignTo: userId ? { users: [userId] } : undefined,
          contextData: {
              message: 'The QBO Customer Sync workflow was triggered without realmId or algaCompanyId in the payload. Investigation needed.',
              payload: triggerEvent.payload,
              executionId: executionId,
              tenantId: tenant,
          },
      } as HumanTaskInput);
      return;
  }

  try {
    // 3. Data Fetching
    setState('FETCHING_DATA');
    logger.info('Fetching Alga Company data', { algaCompanyId, tenantId: tenant });
    // TODO: Confirm action name and parameters for getCompany
    const algaCompany: AlgaCompany = await actions.getCompany({ id: algaCompanyId, tenantId: tenant });
    if (!algaCompany) {
        logger.error('Alga Company not found', { algaCompanyId, tenantId: tenant });
        setState('MAPPING_ERROR'); // Or a more specific error state like 'DATA_NOT_FOUND'
        await actions.createHumanTask({
            taskType: 'internal_workflow_error',
            title: 'Workflow Data Error: Alga Company Not Found',
            description: `Could not fetch Alga Company data for ID: ${algaCompanyId}.`,
            priority: 'high',
            assignTo: userId ? { users: [userId] } : undefined,
            contextData: {
                message: `Could not fetch Alga Company data for ID: ${algaCompanyId}. The company may not exist or there was an issue with the data fetching action.`,
                algaCompanyId: algaCompanyId,
                executionId: executionId,
                tenantId: tenant,
            },
        } as HumanTaskInput);
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
    if (algaCompany.paymentTerm) { // Assuming 'paymentTerm' field holds the Alga term name/ID
        try {
            // TODO: Confirm action name and parameters for lookupQboTermId or use generic lookupExternalEntityId
            const qboTermId = await actions.lookupQboTermId({
                algaTermIdentifier: algaCompany.paymentTerm,
                tenantId: tenant,
                realmId: realmId
            });
            if (qboTermId) {
                qboCustomerData.SalesTermRef = { value: qboTermId };
            } else {
                logger.warn('QBO Term ID not found for Alga term', { algaTerm: algaCompany.paymentTerm, algaCompanyId, tenantId: tenant, realmId });
                // Decide handling: proceed without term, or error out? Project plan implies error.
                setState('MAPPING_ERROR');
                // TODO: Define human task schema for qbo_mapping_error (term mapping)
                await actions.createHumanTask({
                    taskType: 'qbo_mapping_error',
                    title: `QBO Term Mapping Missing for Company ${algaCompany.name}`,
                    description: `Could not find a corresponding QBO Term for Alga term: ${algaCompany.paymentTerm}`,
                    priority: 'medium',
                    assignTo: userId ? { users: [userId] } : undefined,
                    contextData: {
                        message: `Could not find a corresponding QBO Term for Alga term: ${algaCompany.paymentTerm}`,
                        algaCompanyId: algaCompanyId,
                        algaCompanyName: algaCompany.name,
                        algaTerm: algaCompany.paymentTerm,
                        realmId: realmId,
                        workflow_instance_id: executionId,
                    },
                } as HumanTaskInput);
                return; // Stop workflow execution
            }
        } catch (mappingError: any) {
            logger.error('Error looking up QBO Term ID', { error: mappingError.message, algaTerm: algaCompany.paymentTerm, algaCompanyId, tenantId: tenant, realmId });
            setState('MAPPING_ERROR');
             // TODO: Define human task schema for qbo_mapping_error (lookup failure)
            await actions.createHumanTask({
                taskType: 'qbo_sync_error',
                title: `Error looking up QBO Term for Company ${algaCompany.name}`,
                description: `API call failed during QBO Term lookup for Alga term: ${algaCompany.paymentTerm}. Error: ${mappingError.message}`,
                priority: 'high',
                assignTo: userId ? { users: [userId] } : undefined,
                contextData: {
                    message: `API call failed during QBO Term lookup for Alga term: ${algaCompany.paymentTerm}. Error: ${mappingError.message}`,
                    algaCompanyId: algaCompanyId,
                    algaCompanyName: algaCompany.name,
                    algaTerm: algaCompany.paymentTerm,
                    realmId: realmId,
                    errorDetails: mappingError, // Include full error if helpful
                    workflow_instance_id: executionId,
                },
            } as HumanTaskInput);
            return; // Stop workflow execution
        }
    }
    data.set('mappedQboCustomerData', qboCustomerData);
    logger.info('Data mapping complete', { algaCompanyId, tenantId: tenant });

    // Fetch QBO Credentials
    logger.info('Fetching QBO credentials', { realmId, tenantId: tenant, executionId });
    const secretResult = await actions.get_secret({
        secretName: "qbo_credentials", // Changed from "QBO_CREDENTIALS"
        scopeIdentifier: realmId,
        tenantId: tenant // tenantId is implicitly passed via context by the action service, but good to be explicit if the action supports it
    });

    if (!secretResult || !secretResult.success) {
        const errorMessage = secretResult?.message || 'Unknown error fetching QBO credentials.';
        logger.error('Failed to fetch QBO credentials.', {
            algaCompanyId,
            realmId,
            message: errorMessage,
            errorDetails: secretResult?.errorDetails, // Assuming errorDetails might exist
            tenantId: tenant,
            executionId
        });
        setState('QBO_API_ERROR'); // Reusing QBO_API_ERROR state for secret fetch failure
        await actions.createHumanTask({
            taskType: 'secret_fetch_error',
            title: `Failed to Fetch QBO Credentials for Company ${algaCompany.name || algaCompanyId}`,
            description: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}`,
            priority: 'high',
            assignTo: userId ? { users: [userId] } : undefined,
            contextData: {
                message: `The workflow failed to retrieve QBO credentials for realmId: ${realmId}. Error: ${errorMessage}`,
                algaCompanyId: algaCompanyId,
                realmId: realmId,
                errorDetails: secretResult?.errorDetails || errorMessage,
                workflow_instance_id: executionId,
            },
        } as HumanTaskInput);
        return; // Stop workflow execution
    }

    const qboCredentials = secretResult.secret;
    data.set('qboCredentials', qboCredentials); // Store for potential resume/retry scenarios
    logger.info('QBO credentials fetched and stored successfully', { realmId, tenantId: tenant, executionId });


    // 5. Determine Operation & Execute QBO Action
    logger.info('Fetching QBO customer mapping from tenant_external_entity_mappings', { algaCompanyId, realmId, tenantId: tenant });
    const mappingResult = await actions.get_external_entity_mapping({
        algaEntityId: algaCompanyId,
        externalSystemName: 'quickbooks_online', // Or a constant if you have one defined
        externalRealmId: realmId,
        // tenantId is implicit
    });

    let existingQboCustomerId: string | undefined = undefined;
    let qboSyncToken: string | undefined = undefined;

    if (mappingResult && mappingResult.success && mappingResult.found && mappingResult.mapping) {
        existingQboCustomerId = mappingResult.mapping.externalEntityId;
        qboSyncToken = mappingResult.mapping.syncToken;
        logger.info('Found existing QBO mapping', { algaCompanyId, existingQboCustomerId, qboSyncToken });
    } else if (mappingResult && !mappingResult.success) {
        logger.error('Failed to fetch QBO customer mapping', { algaCompanyId, error: mappingResult.message, details: mappingResult.errorDetails });
        // Decide on error handling: stop workflow, create human task, or proceed to create?
        // For now, let's log the error and proceed as if no mapping exists (which will lead to a create attempt).
        // A human task might be appropriate here in a more robust implementation if the lookup fails.
        setState('QBO_API_ERROR'); // Or a more specific state like 'MAPPING_LOOKUP_FAILED'
        await actions.createHumanTask({
            taskType: 'qbo_customer_mapping_lookup_error',
            title: `Failed to lookup QBO mapping for Company ${algaCompany.company_name || algaCompanyId}`,
            description: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}`,
            priority: 'high',
            assignTo: userId ? { users: [userId] } : undefined,
            contextData: {
                message: `The workflow failed to retrieve the QBO customer mapping for Alga Company ID ${algaCompanyId} and Realm ID ${realmId}. Error: ${mappingResult.message}`,
                algaCompanyId: algaCompanyId,
                realmId: realmId,
                errorDetails: mappingResult.errorDetails || mappingResult.message,
                workflow_instance_id: executionId,
            },
        } as HumanTaskInput);
        return; // Stop workflow
    } else {
        logger.info('No existing QBO mapping found for company.', { algaCompanyId });
    }
    // const existingQboCustomerId = algaCompany.qbo_customer_id; // Assuming field name
    // const qboSyncToken = algaCompany.qbo_sync_token; // Assuming field name for updates

    try {
        let qboResult: QboCustomerResult;

        if (existingQboCustomerId) {
            // --- UPDATE PATH ---
            setState('CALLING_QBO_UPDATE');
            logger.info('Calling QBO Update Customer API', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
            if (!qboSyncToken) {
                 logger.error('Missing qboSyncToken for QBO Customer update', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant, realmId });
                 setState('QBO_API_ERROR'); // Or a specific state like 'MISSING_SYNC_TOKEN'
                 // TODO: Create human task for missing sync token
                 await actions.createHumanTask({
                     taskType: 'qbo_sync_error',
                     title: `Missing SyncToken for QBO Customer Update - ${algaCompany.name}`,
                     description: `Cannot update QBO Customer ${existingQboCustomerId} because the qbo_sync_token is missing in the Alga Company record. Manual intervention may be required.`,
                     priority: 'high',
                     assignTo: userId ? { users: [userId] } : undefined,
                     contextData: {
                         workflowInstanceId: executionId,
                         errorCode: "QBO_MISSING_SYNC_TOKEN",
                         errorMessageText: `Cannot update QBO Customer ${existingQboCustomerId} (Alga ID: ${algaCompanyId}) because the QBO sync token is missing. Manual intervention may be required.`,
                         entityType: ENTITY_TYPE_CUSTOMER,
                         entityId: algaCompanyId,
                         operation: "Update QBO Customer",
                         realmId: realmId,
                         workflowStateAtError: getCurrentState(),
                         // Additional context for other consumers/debugging, not directly used by the form's primary template
                         algaCompanyNameForContext: algaCompany.name,
                         qboCustomerIdForContext: existingQboCustomerId
                     },
                 } as HumanTaskInput);
                 return;
            }

            // TODO: Confirm action name and parameters for updateQboCustomer
            qboResult = await actions.update_qbo_customer({ // Corrected action name
                qboCustomerId: existingQboCustomerId,
                qboSyncToken: qboSyncToken,
                qboCustomerData: { ...qboCustomerData, Id: existingQboCustomerId, SyncToken: qboSyncToken }, // QBO often requires Id and SyncToken in payload
                tenantId: tenant,
                realmId: realmId,
                qboCredentials: qboCredentials // Pass fetched credentials
            });
            logger.info('QBO Update Customer API call successful', { algaCompanyId, qboCustomerId: existingQboCustomerId, tenantId: tenant });

        } else {
            // --- CREATE PATH ---

            // Optional: Duplicate Check (Implement based on project plan decision)
            const performDuplicateCheck = true; // Set based on config or decision
            if (performDuplicateCheck) {
                setState('CHECKING_QBO_DUPLICATES');
                
                const displayNameForCheck = qboCustomerData.DisplayName;
                const emailForCheck = qboCustomerData.PrimaryEmailAddr?.Address;

                if (!displayNameForCheck && !emailForCheck) {
                    logger.warn('Cannot perform QBO duplicate check: both DisplayName and Email are missing from Alga Company data.', { algaCompanyId, tenantId: tenant, realmId });
                    // Optionally, create a human task here if this is a critical issue.
                    // For now, we proceed as if no duplicates were found, but this might need review based on business rules.
                    logger.info('Skipping QBO duplicate check due to missing key identifiers. Proceeding as if no duplicates found.', { algaCompanyId, tenantId: tenant, realmId });
                } else {
                    logger.info('Checking for potential QBO duplicate customers', { displayName: displayNameForCheck, email: emailForCheck, tenantId: tenant, realmId });
                    try {
                        const potentialDuplicatesResult = await actions.get_qbo_customer_by_display_or_email({
                            displayName: displayNameForCheck,
                            email: emailForCheck,
                            tenantId: tenant,
                            realmId: realmId,
                            qboCredentials: qboCredentials // Pass fetched credentials
                        });

                        if (!potentialDuplicatesResult.success) {
                            logger.error('Failed to check for QBO duplicate customers.', {
                                algaCompanyId,
                                message: potentialDuplicatesResult.message,
                                errorDetails: potentialDuplicatesResult.errorDetails,
                                tenantId: tenant,
                                realmId
                            });
                            setState('QBO_API_ERROR'); // Or a more specific state like 'DUPLICATE_CHECK_FAILED'
                            await actions.createHumanTask({
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
                            } as HumanTaskInput);
                            return; // Stop workflow execution
                        }

                        if (potentialDuplicatesResult.found && potentialDuplicatesResult.customers && potentialDuplicatesResult.customers.length > 0) {
                            console.warn('Potential QBO duplicate customer(s) found', {
                                algaCompanyId,
                                potentialDuplicates: potentialDuplicatesResult.customers.map((d: any) => ({ id: d.Id, name: d.DisplayName, email: d.PrimaryEmailAddr?.Address })),
                                tenantId: tenant,
                                realmId,
                                algaCompany
                            });
                            setState('DUPLICATE_CHECK_REQUIRED');
                            await actions.createHumanTask({
                                taskType: 'qbo_sync_error',
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
                            } as HumanTaskInput);
                            return; // Stop workflow execution
                        } else {
                             logger.info('No potential QBO duplicates found or check was successful with no matches.', { algaCompanyId, tenantId: tenant, realmId });
                        }
                    } catch (dupCheckError: any) { // This catch block might now be less likely to be hit if the action itself handles errors gracefully
                         logger.error('Unexpected error during QBO duplicate check invocation', { error: dupCheckError.message, algaCompanyId, tenantId: tenant, realmId });
                         // Decide how to handle: proceed with create, or fail? Failing might be safer.
                         setState('QBO_API_ERROR'); // Treat as API error for now
                         // TODO: Create human task for duplicate check failure
                         await actions.createHumanTask({
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
                                 algaCompanyNameForContext: algaCompany.name, // Ensuring consistent naming for additional context
                                 rawErrorObjectForContext: dupCheckError, // Using "Object" to clarify it's the error object
                             },
                         } as HumanTaskInput);
                         return;
                    } // End of try-catch for duplicate check
                } // End of else for if (!displayNameForCheck && !emailForCheck)
            } // End Optional Duplicate Check

            // Proceed with Create
            setState('CALLING_QBO_CREATE');
            logger.info('Calling QBO Create Customer API', { algaCompanyId, tenantId: tenant, realmId });
            // TODO: Confirm action name and parameters for createQboCustomer
            qboResult = await actions.create_qbo_customer({
                qboCustomerData: qboCustomerData,
                tenantId: tenant,
                realmId: realmId,
                qboCredentials: qboCredentials // Pass fetched credentials
            });
            logger.info('QBO Create Customer API call successful', { algaCompanyId, newQboCustomerId: qboResult?.Customer?.Id, tenantId: tenant });
        }

        // --- POST-QBO CALL (Success) ---
        const newQboCustomerId = qboResult?.Customer?.Id; // Adjust based on actual action result structure
        const newQboSyncToken = qboResult?.Customer?.SyncToken; // Adjust based on actual action result structure

        if (!newQboCustomerId || !newQboSyncToken) {
             logger.error('QBO API result missing Customer ID or SyncToken', { qboResult, algaCompanyId, tenantId: tenant, realmId });
             setState('QBO_API_ERROR'); // Or a specific state like 'INVALID_QBO_RESPONSE'
             // TODO: Create human task for invalid QBO response
             await actions.createHumanTask({
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
                     qboApiResponseForContext: qboResult, // Ensuring consistent naming
                 },
             } as HumanTaskInput);
             return;
        }

        data.set('qboResult', qboResult);

        // 6. Update Alga Company Record
        setState('UPDATING_ALGA');
        logger.info('Updating Alga Company with QBO details', { algaCompanyId, qboCustomerId: newQboCustomerId, tenantId: tenant });
        // TODO: Confirm action name and parameters for updateCompanyQboDetails
        await actions.update_company_qbo_details({
            companyId: algaCompanyId,
            qboCustomerId: newQboCustomerId,
            qboSyncToken: newQboSyncToken,
            realmId: realmId
        });
        logger.info('Alga Company updated successfully', { algaCompanyId, qboCustomerId: newQboCustomerId, tenantId: tenant });

        // 7. Final State
        setState('SYNC_COMPLETE');
        logger.info('QBO Customer sync successful', { algaCompanyId, qboCustomerId: newQboCustomerId, tenantId: tenant, executionId });

    } catch (error: any) {
        // --- QBO API CALL FAILED ---
        // Ensure realmId is available in the catch block if needed for logging/task creation
        const currentRealmId = triggerEvent?.payload?.realmId || 'UNKNOWN'; // Get realmId safely from triggerEvent
        logger.error('QBO API call failed', { error: error.message, stack: error.stack, currentState: getCurrentState(), algaCompanyId, tenantId: tenant, realmId: currentRealmId });
        setState('QBO_API_ERROR');
        data.set('qboApiError', {
            message: error.message,
            details: error.response?.data || error.stack || error // Capture relevant details
        });

        // TODO: Implement more sophisticated retry logic if needed (e.g., using Temporal retries on the activity)
        // Basic check: Maybe retry once on specific errors? For now, just log and create task.

        // Create Human Task for persistent errors
        // TODO: Define human task schema for qbo_sync_error
        await actions.createHumanTask({
            taskType: 'qbo_sync_error',
            title: `QBO Customer Sync Failed for ${algaCompany?.name || `ID: ${algaCompanyId}`}`,
            description: `The QBO API call failed during customer sync. Error: ${error.message}`,
            priority: 'high',
            assignTo: userId ? { users: [userId] } : undefined,
            contextData: {
                workflowInstanceId: executionId,
                errorCode: "QBO_API_CALL_FAILED", // Or more specific if error.code exists and is useful
                errorMessageText: error.message,
                entityType: ENTITY_TYPE_CUSTOMER,
                entityId: algaCompanyId,
                operation: getCurrentState() === 'CALLING_QBO_CREATE' ? "Create QBO Customer" : getCurrentState() === 'CALLING_QBO_UPDATE' ? "Update QBO Customer" : "QBO Customer Sync",
                realmId: currentRealmId,
                workflowStateAtError: getCurrentState(),
                algaCompanyNameForContext: algaCompany?.name,
                qboCustomerIdAttemptedForContext: existingQboCustomerId, // Will be undefined if create was attempted
                mappedQboDataForContext: data.get('mappedQboCustomerData'), // Data that was being sent
                rawErrorObjectForContext: data.get('qboApiError'), // The error object stored earlier
            },
        } as HumanTaskInput);
        // Workflow ends here due to error
    } // End outer try...catch for QBO call + Alga update

  } catch (outerError: any) {
      // Catch errors from initial data fetching or mapping stages
      const currentAlgaCompanyId = triggerEvent?.payload?.company_id || 'UNKNOWN';
      logger.error('Workflow failed before QBO interaction', { error: outerError.message, stack: outerError.stack, currentState: getCurrentState(), algaCompanyId: currentAlgaCompanyId, tenantId: tenant, executionId });
      // Ensure state reflects the error, potentially set earlier, or set a generic one
      if (getCurrentState() !== 'MAPPING_ERROR' && getCurrentState() !== 'INITIAL') { // Avoid overwriting specific mapping errors or if still initial
          setState('QBO_API_ERROR'); // Reuse or create a more generic 'WORKFLOW_ERROR' state
      }
      // Optionally create a human task for these early failures too
      // TODO: Consider if a human task is needed for fetch/map errors not already handled
  }
} // End workflow function
