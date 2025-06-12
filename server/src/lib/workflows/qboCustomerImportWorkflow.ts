import { WorkflowContext } from '../../../../shared/workflow/core';
import { QboCustomerImporter } from '../import/qbo/QboCustomerImporter';
import { ImportManager } from '../import/ImportManager';
import { createTenantKnex } from '../db';

// Define WorkflowState as a simple object for better portability
const WorkflowState = {
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED'
};

type TriggerEventPayload = {
  jobId: string;
  sourceId: string;
  artifactType: 'company' | 'contact';
  requestedBy?: string;
  tenant: string;
};

type TriggerEvent = {
  name: string; // "IMPORT_JOB_REQUESTED"
  payload: TriggerEventPayload;
};

/**
 * Workflow to import customers from QuickBooks Online into Alga PSA
 * Triggered by IMPORT_JOB_REQUESTED event with sourceId = 'qbo'
 */
export async function qboCustomerImportWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, events, logger, setState, getCurrentState, tenant, executionId, userId } = context;

  // 1. Initialization & State
  setState(WorkflowState.RUNNING);
  logger.info('QBO Customer Import workflow started', { tenantId: tenant, executionId });

  // 2. Get trigger event
  const triggerEvent = data.get<TriggerEvent>('triggerEvent');
  if (!triggerEvent || !triggerEvent.payload) {
    logger.error('No trigger event found in workflow context');
    setState(WorkflowState.FAILED);
    return;
  }

  const { jobId, sourceId, artifactType, requestedBy } = triggerEvent.payload;
  
  logger.info('Processing import job request', { 
    jobId, 
    sourceId, 
    artifactType, 
    requestedBy, 
    tenantId: tenant 
  });

  // Validate this is a QBO customer import
  if (sourceId !== 'qbo' || (artifactType !== 'company' && artifactType !== 'contact')) {
    logger.error('Invalid import request for QBO customer import workflow', { 
      sourceId, 
      artifactType 
    });
    setState(WorkflowState.FAILED);
    return;
  }

  const { knex } = await createTenantKnex();
  const importManager = new ImportManager(knex, tenant);
  
  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  try {
    // 3. Update job status to RUNNING
    await importManager.updateJobState(jobId, 'RUNNING', null, executionId);
    
    // 4. Get QBO realm ID for this tenant
    logger.info('Fetching QBO realm ID for tenant', { tenantId: tenant });
    
    let realmId: string | null = null;
    const mappingResult = await actions.get_tenant_qbo_mappings({ tenantId: tenant });
    
    if (mappingResult && mappingResult.success && mappingResult.mappings && mappingResult.mappings.length > 0) {
      // Use the first realm ID found
      realmId = mappingResult.mappings[0].realmId;
      logger.info('Found QBO realm ID', { realmId, tenantId: tenant });
    } else {
      logger.error('No QBO connection found for tenant', { tenantId: tenant });
      await importManager.updateJobState(jobId, 'ERROR', {
        error: 'No QuickBooks Online connection found. Please connect to QuickBooks Online first.',
        processedCount: 0
      });
      setState(WorkflowState.FAILED);
      return;
    }

    // 5. Create importer instance
    const importer = new QboCustomerImporter(tenant, realmId);
    
    // 6. Import customers using the importer
    logger.info('Starting customer import', { tenantId: tenant, realmId });
    
    await importer.import({
      jobId,
      tenant,
      knex,
      onProgress: async (processed: number) => {
        processedCount = processed;
        // Report progress every 10 items
        if (processed % 10 === 0) {
          await importManager.reportProgress(jobId, processed);
          logger.info('Import progress', { jobId, processed });
        }
      },
      onItemProcessed: async (externalId: string, algaEntityId: string | null, status: 'SUCCESS' | 'ERROR' | 'SKIPPED', message?: string) => {
        // The workflow will handle the actual entity creation/update
        // For now, just track the mapping preparation
        
        if (status === 'SUCCESS') {
          successCount++;
          
          // Get the mapped data from the importer
          const mappedData = data.get(`mapped_${externalId}`);
          if (mappedData) {
            try {
              // Process each mapped entity (company and/or contact)
              for (const mapped of (Array.isArray(mappedData) ? mappedData : [mappedData])) {
                if (mapped.entityType === 'company') {
                  // Create or update company
                  const existingCompany = await actions.getCompanyByEmail({ 
                    email: mapped.entity.email,
                    tenantId: tenant 
                  });
                  
                  let companyId: string;
                  if (existingCompany && existingCompany.company_id) {
                    // Update existing company
                    await actions.updateCompany({
                      id: existingCompany.company_id,
                      ...mapped.entity,
                      tenantId: tenant
                    });
                    companyId = existingCompany.company_id;
                    logger.info('Updated existing company', { companyId, qboId: externalId });
                  } else {
                    // Create new company
                    const result = await actions.createCompany({
                      ...mapped.entity,
                      tenantId: tenant
                    });
                    companyId = result.company_id;
                    logger.info('Created new company', { companyId, qboId: externalId });
                  }
                  
                  // Store mapping
                  await actions.upsert_external_entity_mapping({
                    algaEntityId: companyId,
                    algaEntityType: 'company',
                    externalSystemName: 'quickbooks_online',
                    externalEntityId: externalId,
                    externalEntityType: 'Customer',
                    externalRealmId: realmId,
                    metadata: mapped.entity.metadata,
                    syncToken: mapped.entity.metadata?.qbo_sync_token
                  });
                  
                } else if (mapped.entityType === 'contact') {
                  // Create or update contact
                  const existingContact = await actions.getContactByEmail({ 
                    email: mapped.entity.email,
                    tenantId: tenant 
                  });
                  
                  let contactId: string;
                  if (existingContact && existingContact.contact_id) {
                    // Update existing contact
                    await actions.updateContact({
                      id: existingContact.contact_id,
                      ...mapped.entity,
                      tenantId: tenant
                    });
                    contactId = existingContact.contact_id;
                    logger.info('Updated existing contact', { contactId, qboId: externalId });
                  } else {
                    // Create new contact
                    const result = await actions.createContact({
                      ...mapped.entity,
                      tenantId: tenant
                    });
                    contactId = result.contact_id;
                    logger.info('Created new contact', { contactId, qboId: externalId });
                  }
                  
                  // Store mapping
                  await actions.upsert_external_entity_mapping({
                    algaEntityId: contactId,
                    algaEntityType: 'contact',
                    externalSystemName: 'quickbooks_online',
                    externalEntityId: externalId,
                    externalEntityType: 'Customer',
                    externalRealmId: realmId,
                    metadata: mapped.entity.metadata,
                    syncToken: mapped.entity.metadata?.qbo_sync_token
                  });
                }
              }
              
              await importManager.reportItemProcessed(
                jobId,
                externalId,
                null, // We don't have a single entity ID when multiple are created
                'SUCCESS',
                'Imported successfully'
              );
              
            } catch (entityError: any) {
              logger.error('Error creating/updating entity', { 
                error: entityError.message, 
                externalId 
              });
              errorCount++;
              await importManager.reportItemProcessed(
                jobId,
                externalId,
                null,
                'ERROR',
                entityError.message
              );
            }
          }
        } else if (status === 'ERROR') {
          errorCount++;
          await importManager.reportItemProcessed(jobId, externalId, algaEntityId, status, message);
        }
        
        // Store the mapped data for the workflow to process
        const mappedResult = importer.mapToAlga({ Id: externalId } as any);
        data.set(`mapped_${externalId}`, mappedResult);
      }
    });

    // 7. Update job as complete
    const duration = Date.now() - startTime;
    await importManager.updateJobState(jobId, 'SUCCESS', {
      totalImported: processedCount,
      successCount,
      errorCount,
      duration
    });
    
    setState(WorkflowState.COMPLETE);
    logger.info('QBO Customer import completed successfully', { 
      jobId, 
      processedCount, 
      successCount, 
      errorCount,
      duration,
      tenantId: tenant 
    });

  } catch (error: any) {
    logger.error('QBO Customer import failed', { 
      error: error.message, 
      stack: error.stack,
      jobId,
      tenantId: tenant 
    });
    
    // Update job as failed
    await importManager.updateJobState(jobId, 'ERROR', {
      error: error.message,
      processedCount,
      successCount,
      errorCount
    });
    
    setState(WorkflowState.FAILED);
  }
}