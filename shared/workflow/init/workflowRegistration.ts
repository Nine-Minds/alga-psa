import { getWorkflowRuntime } from '../core/workflowRuntime';
import { getActionRegistry } from '../core/actionRegistry';
import { invoiceApprovalWorkflow } from '../examples/invoiceApprovalWorkflow';
import logger from '@shared/core/logger.js';
import { Knex } from 'knex';
import { WorkflowRegistrationModel } from '../persistence';

/**
 * Register all example workflows with the runtime
 * This function should be called during application startup
 */
export async function registerExampleWorkflows(): Promise<void> {
  try {
    // Get the action registry
    const actionRegistry = getActionRegistry();
    
    // Get the workflow runtime
    const runtime = getWorkflowRuntime(actionRegistry);
    
    // Register example workflows
    runtime.registerWorkflow(invoiceApprovalWorkflow);
    
    // Log successful registration
    logger.info('Example workflows registered successfully');
    
    try {
      // Load database-defined workflows
      await loadDatabaseWorkflows(runtime);
    } catch (dbError) {
      logger.warn('Failed to load database-defined workflows:', dbError);
      logger.info('Continuing with code-defined workflows only');
    }
    
    // Get all registered workflows for verification
    const registeredWorkflows = runtime.getRegisteredWorkflows();
    logger.info(`Registered workflows: ${Array.from(registeredWorkflows.keys()).join(', ')}`);
  } catch (error) {
    logger.error('Failed to register example workflows:', error);
  }
}

/**
 * Load workflow definitions from the database
 * This function loads all active workflow registrations from the database
 * and registers them with the runtime
 * 
 * @param runtime The workflow runtime instance
 */
async function loadDatabaseWorkflows(runtime: any): Promise<void> {
  try {
    // Create a knex instance
    const knex = runtime.getKnexInstance();
    if (!knex) {
      logger.error('No knex instance available for loading database workflows');
      return;
    }
    
    // Get the tenant from the context
    const tenant = runtime.getTenant();
    if (!tenant) {
      logger.error('No tenant available for loading database workflows');
      return;
    }
    
    // Get all active workflow registrations from the database using the model
    const registrations = await WorkflowRegistrationModel.getAll(knex, tenant);
    
    if (registrations.length === 0) {
      logger.info('No database-defined workflows found');
      return;
    }
    
    // Log the number of database-defined workflows found
    logger.info(`Found ${registrations.length} database-defined workflows`);
    
    // For each registration, get the workflow definition and register it with the runtime
    for (const registration of registrations) {
      try {
        // Get the workflow definition using the runtime's getWorkflowDefinition method
        // This will deserialize the workflow function
        const workflowDef = await runtime.getWorkflowDefinition(registration.name);
        
        if (workflowDef) {
          logger.info(`Loaded database-defined workflow: ${registration.name}`);
        } else {
          logger.warn(`Failed to load database-defined workflow: ${registration.name}`);
        }
      } catch (error) {
        logger.error(`Error loading database-defined workflow ${registration.name}:`, error);
      }
    }
  } catch (error) {
    logger.error('Failed to load database-defined workflows:', error);
    throw error;
  }
}