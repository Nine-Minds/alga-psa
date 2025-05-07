/**
 * Shared module for registering workflow actions
 * This file contains all the action registration logic and can be called
 * from both the server and the workflow-worker
 */

import { getActionRegistry, type ActionRegistry, type ActionExecutionContext } from '@shared/workflow/core/index.js';
import logger from '@shared/core/logger.js';
import { getTaskInboxService } from '@shared/workflow/core/taskInboxService.js';

/**
 * Register all workflow actions with the action registry
 * @returns The action registry with all actions registered
 */
export function registerWorkflowActions(): ActionRegistry {
  logger.info('[WorkflowInit] Starting registration of workflow actions...');
  // Get the action registry
  const actionRegistry = getActionRegistry();
  
  // Register common actions
  registerCommonActions(actionRegistry);
  
  let registeredActions = Object.keys(actionRegistry.getRegisteredActions());
  logger.info(`[WorkflowInit] Actions registered after common actions: ${registeredActions.join(', ')}`);
  logger.info(`[WorkflowInit] Total common actions registered: ${registeredActions.length}`);

  // Register task inbox actions
  registerTaskInboxActions(actionRegistry);

  registeredActions = Object.keys(actionRegistry.getRegisteredActions());
  logger.info(`[WorkflowInit] Actions registered after task inbox actions: ${registeredActions.join(', ')}`);
  logger.info(`[WorkflowInit] Total actions registered: ${registeredActions.length}`);
  
  logger.info('[WorkflowInit] Workflow action registration complete.');
  return actionRegistry;
}

/**
 * Register common workflow actions
 * @param actionRegistry The action registry to register with
 */
function registerCommonActions(actionRegistry: ActionRegistry): void {
  // Register form action
  actionRegistry.registerSimpleAction(
    'register_form',
    'Register a form definition with the form registry',
    [
      { name: 'formId', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'version', type: 'string', required: true },
      { name: 'category', type: 'string', required: true },
      { name: 'status', type: 'string', required: false },
      { name: 'jsonSchema', type: 'object', required: true },
      { name: 'uiSchema', type: 'object', required: false },
      { name: 'defaultValues', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import the form registry
        const { getFormRegistry } = await import('@shared/workflow/core/formRegistry.js');
        const formRegistry = getFormRegistry();
        
        // Create Knex instance
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Register the form
        const formId = await formRegistry.register(
          knex,
          context.tenant,
          {
            formId: params.formId,
            name: params.name,
            description: params.description,
            version: params.version,
            category: params.category,
            status: params.status || 'ACTIVE',
            jsonSchema: params.jsonSchema,
            uiSchema: params.uiSchema,
            defaultValues: params.defaultValues
          },
          context.userId
        );
        
        return {
          success: true,
          formId
        };
      } catch (error) {
        logger.error('Error registering form:', error);
        throw error;
      }
    }
  );
  
  // Get form by ID and version action
  actionRegistry.registerSimpleAction(
    'get_form',
    'Get a form definition by ID and optional version',
    [
      { name: 'formId', type: 'string', required: true },
      { name: 'version', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import the form registry
        const { getFormRegistry } = await import('@shared/workflow/core/formRegistry.js');
        const formRegistry = getFormRegistry();
        
        // Create Knex instance
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Get the form
        const form = await formRegistry.getForm(
          knex,
          context.tenant,
          params.formId,
          params.version
        );
        
        if (!form) {
          return {
            success: false,
            exists: false,
            message: `Form with ID ${params.formId}${params.version ? ` and version ${params.version}` : ''} not found`
          };
        }
        
        return {
          success: true,
          exists: true,
          form: {
            formId: form.definition.form_id,
            name: form.definition.name,
            description: form.definition.description,
            version: form.definition.version,
            category: form.definition.category,
            status: form.definition.status,
            jsonSchema: form.schema.json_schema,
            uiSchema: form.schema.ui_schema,
            defaultValues: form.schema.default_values
          }
        };
      } catch (error: any) {
        logger.error('Error getting form:', error);
        return {
          success: false,
          exists: false,
          message: error.message
        };
      }
    }
  );
  
  // Create new form version action
  actionRegistry.registerSimpleAction(
    'create_form_version',
    'Create a new version of an existing form',
    [
      { name: 'formId', type: 'string', required: true },
      { name: 'newVersion', type: 'string', required: true },
      { name: 'name', type: 'string', required: false },
      { name: 'description', type: 'string', required: false },
      { name: 'category', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
      { name: 'jsonSchema', type: 'object', required: false },
      { name: 'uiSchema', type: 'object', required: false },
      { name: 'defaultValues', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import the form registry
        const { getFormRegistry } = await import('@shared/workflow/core/formRegistry.js');
        const formRegistry = getFormRegistry();
        
        // Create Knex instance
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Create new version
        const formId = await formRegistry.createNewVersion(
          knex,
          context.tenant,
          params.formId,
          params.newVersion,
          {
            name: params.name,
            description: params.description,
            category: params.category,
            status: params.status,
            jsonSchema: params.jsonSchema,
            uiSchema: params.uiSchema,
            defaultValues: params.defaultValues
          }
        );
        
        return {
          success: true,
          formId,
          newVersion: params.newVersion
        };
      } catch (error) {
        logger.error('Error creating form version:', error);
        throw error;
      }
    }
  );

  // Find a user by their email address
  actionRegistry.registerSimpleAction(
    'find_user_by_email',
    'Find a user by their email address',
    [
      { name: 'email', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`Looking up user with email: ${params.email}`);
        
        // Get database connection
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Find user by email - case insensitive search
        const user = await knex('users')
          .select('*')
          .where({ tenant: context.tenant })
          .whereRaw('LOWER(email) = LOWER(?)', [params.email])
          .first();
        
        if (!user) {
          logger.info(`No user found with email: ${params.email}`);
          return {
            success: false,
            found: false,
            message: `User with email ${params.email} not found`
          };
        }
        
        logger.info(`Found user with email ${params.email}: ${user.user_id}`);
        
        // Return user using the same property names as IUser interface
        return {
          success: true,
          found: true,
          user: {
            user_id: user.user_id,
            email: user.email,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            tenant: user.tenant,
            user_type: user.user_type,
            is_inactive: user.is_inactive,
            contact_id: user.contact_id
          }
        };
      } catch (error: any) {
        logger.error('Error finding user by email:', error);
        return {
          success: false,
          found: false,
          message: error.message
        };
      }
    }
  );
  
  // Find a role by its name
  actionRegistry.registerSimpleAction(
    'find_role_by_name',
    'Find a role by its name',
    [
      { name: 'roleName', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`Looking up role with name: ${params.roleName}`);
        
        // Get database connection
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Find role by name - case insensitive search
        const role = await knex('roles')
          .select('*')
          .where({ tenant: context.tenant })
          .whereRaw('LOWER(role_name) = LOWER(?)', [params.roleName])
          .first();
        
        if (!role) {
          logger.info(`No role found with name: ${params.roleName}`);
          return {
            success: false,
            found: false,
            message: `Role with name ${params.roleName} not found`
          };
        }
        
        logger.info(`Found role with name ${params.roleName}: ${role.role_id}`);
        
        // Return role using the same property names as IRole interface
        return {
          success: true,
          found: true,
          role: {
            role_id: role.role_id,
            role_name: role.role_name,
            description: role.description,
            tenant: role.tenant
          }
        };
      } catch (error: any) {
        logger.error('Error finding role by name:', error);
        return {
          success: false,
          found: false,
          message: error.message
        };
      }
    }
  );

  // Log audit event action
  actionRegistry.registerSimpleAction(
    'log_audit_event',
    'Log an audit event',
    [
      { name: 'eventType', type: 'string', required: true },
      { name: 'entityId', type: 'string', required: true },
      { name: 'user', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[AUDIT] ${params.eventType} for ${params.entityId} by ${params.user || 'system'}`);
      return { success: true };
    }
  );
  
  // Log audit message action
  actionRegistry.registerSimpleAction(
    'log_audit_message',
    'Log an audit message with optional metadata',
    [
      { name: 'message', type: 'string', required: true },
      { name: 'user', type: 'string', required: false },
      { name: 'metadata', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[AUDIT] ${params.message} ${params.user ? `by ${params.user}` : ''}`, {
        tenant: context.tenant,
        executionId: context.executionId,
        metadata: params.metadata
      });
      return { success: true };
    }
  );
  
  // Send notification action
  actionRegistry.registerSimpleAction(
    'send_notification',
    'Send a notification',
    [
      { name: 'recipient', type: 'string', required: true },
      { name: 'message', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[NOTIFICATION] To: ${params.recipient}, Message: ${params.message}`);
      return { success: true, notificationId: `notif-${Date.now()}` };
    }
  );
  
  // Get user role action
  actionRegistry.registerSimpleAction(
    'get_user_role',
    'Get user role',
    [
      { name: 'userId', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      // Mock implementation - in a real system, this would query a database
      const roles = {
        'user1': 'user',
        'user2': 'manager',
        'user3': 'senior_manager',
        'user4': 'admin'
      };
      
      const role = params.userId in roles 
        ? roles[params.userId as keyof typeof roles] 
        : 'user';
        
      return role;
    }
  );

  // Placeholder for get_invoice
  actionRegistry.registerSimpleAction(
    'get_invoice',
    'Get an invoice by ID (placeholder)',
    [
      { name: 'id', type: 'string', required: true },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] get_invoice called for id: ${params.id}, tenant: ${context.tenant}`);
      // Return dummy AlgaInvoice
      return {
        id: params.id,
        companyId: `dummy-company-for-${params.id}`,
        qbo_invoice_id: 'dummy-qbo-id',
        qbo_sync_token: 'dummy-sync-token'
      };
    }
  );

  // Placeholder for get_invoice_items
  actionRegistry.registerSimpleAction(
    'get_invoice_items',
    'Get invoice items by invoice ID (placeholder)',
    [
      { name: 'invoiceId', type: 'string', required: true },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] get_invoice_items called for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`);
      // Return dummy AlgaInvoiceItem[]
      return [
        { id: 'dummy-item-1', invoiceId: params.invoiceId, productId: 'dummy-prod-1', amount: 100 },
        { id: 'dummy-item-2', invoiceId: params.invoiceId, productId: 'dummy-prod-2', amount: 200 },
      ];
    }
  );

  // Placeholder for get_company
  actionRegistry.registerSimpleAction(
    'get_company',
    'Get a company by ID (placeholder)',
    [
      { name: 'id', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] get_company called for id: ${params.id}, tenant: ${context.tenant}`);
      return {
        id: params.id,
        qbo_customer_id: `dummy-qbo-customer-${params.id}`,
        qbo_term_id: 'dummy-qbo-term'
      };
    }
  );

  // Placeholder for lookup_qbo_item_id
  actionRegistry.registerSimpleAction(
    'lookup_qbo_item_id',
    'Lookup QBO item ID by Alga product ID (placeholder)',
    [
      { name: 'algaProductId', type: 'string', required: true },
      { name: 'realmId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] lookup_qbo_item_id called for algaProductId: ${params.algaProductId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);
      return `dummy-qbo-item-for-${params.algaProductId}`;
    }
  );

  // Placeholder for trigger_workflow
  actionRegistry.registerSimpleAction(
    'trigger_workflow',
    'Trigger another workflow (placeholder)',
    [
      { name: 'name', type: 'string', required: true },
      { name: 'input', type: 'object', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] trigger_workflow called for name: ${params.name}, tenant: ${context.tenant}`, { input: params.input });
      return { success: true, triggeredExecutionId: `dummy-exec-${Date.now()}` };
    }
  );

  // Placeholder for update_qbo_invoice
  actionRegistry.registerSimpleAction(
    'update_qbo_invoice',
    'Update an existing QBO invoice (placeholder)',
    [
      { name: 'qboInvoiceData', type: 'object', required: true },
      { name: 'qboInvoiceId', type: 'string', required: true },
      { name: 'qboSyncToken', type: 'string', required: true },
      { name: 'realmId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] update_qbo_invoice called for qboInvoiceId: ${params.qboInvoiceId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);
      return { Id: params.qboInvoiceId, SyncToken: `new-dummy-sync-token-${Date.now()}` };
    }
  );

  // Placeholder for create_qbo_invoice
  actionRegistry.registerSimpleAction(
    'create_qbo_invoice',
    'Create a new QBO invoice (placeholder)',
    [
      { name: 'qboInvoiceData', type: 'object', required: true },
      { name: 'realmId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const newId = `dummy-new-qbo-inv-${Date.now()}`;
      logger.info(`[ACTION DUMMY] create_qbo_invoice called for realmId: ${params.realmId}, tenant: ${context.tenant}. New ID: ${newId}`);
      return { Id: newId, SyncToken: `dummy-sync-token-${Date.now()}` };
    }
  );

  // Placeholder for update_invoice_qbo_details
  actionRegistry.registerSimpleAction(
    'update_invoice_qbo_details',
    'Update Alga invoice QBO details (placeholder)',
    [
      { name: 'invoiceId', type: 'string', required: true },
      { name: 'qboInvoiceId', type: 'string', required: false },
      { name: 'qboSyncToken', type: 'string', required: false },
      { name: 'lastSyncStatus', type: 'string', required: true },
      { name: 'lastSyncTimestamp', type: 'string', required: true },
      { name: 'lastSyncError', type: 'object', required: false },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION DUMMY] update_invoice_qbo_details called for invoiceId: ${params.invoiceId}, status: ${params.lastSyncStatus}, tenant: ${context.tenant}`);
      return { success: true };
    }
  );
}

/**
 * Register task inbox actions
 * @param actionRegistry The action registry to register with
 */
function registerTaskInboxActions(actionRegistry: ActionRegistry): void {
  const taskInboxService = getTaskInboxService();
  taskInboxService.registerTaskActions(actionRegistry);
}