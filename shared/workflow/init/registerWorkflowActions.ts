/**
 * Shared module for registering workflow actions
 * This file contains all the action registration logic and can be called
 * from both the server and the workflow-worker
 */

import { getActionRegistry, type ActionRegistry, type ActionExecutionContext } from '@alga-psa/shared/workflow/core/index';
import { logger } from '@alga-psa/shared/core';
import { getTaskInboxService } from '@alga-psa/shared/workflow/core/taskInboxService';

// --- Mock Secret Retrieval ---


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

  // Email actions are registered separately in the workflow worker
  // to avoid server dependencies in the shared library

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
        const { getFormRegistry } = await import('@alga-psa/shared/workflow/core/formRegistry');
        const formRegistry = getFormRegistry();

        // Create Knex instance
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
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
        const { getFormRegistry } = await import('@alga-psa/shared/workflow/core/formRegistry');
        const formRegistry = getFormRegistry();

        // Create Knex instance
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
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
        const { getFormRegistry } = await import('@alga-psa/shared/workflow/core/formRegistry');
        const formRegistry = getFormRegistry();

        // Create Knex instance
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
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
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
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
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
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
      logger.info(`[ACTION] get_invoice called for id: ${params.id}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const invoice = await knex('invoices')
          .select('*')
          .where({ invoice_id: params.id, tenant: context.tenant })
          .first();

        if (!invoice) {
          logger.warn(`[ACTION] get_invoice: Invoice not found for id: ${params.id}, tenant: ${context.tenant}`);
          // To align with Promise<AlgaInvoice> as expected by the workflow's type definitions,
          // we should throw an error if the invoice is not found.
          const err = new Error(`Invoice with id ${params.id} not found for tenant ${context.tenant}.`);
          // It can be helpful to add a status or code to errors for more specific handling upstream.
          (err as any).status = 404;
          throw err;
        }

        logger.info(`[ACTION] get_invoice: Successfully fetched invoice id: ${params.id}`);
        logger.info(`[ACTION] get_invoice: Invoice details from DB: ${JSON.stringify(invoice)}`);

        // Return the raw database object directly
        return invoice;
      } catch (error: any) {
        logger.error(`[ACTION] get_invoice: Error fetching invoice id: ${params.id}, tenant: ${context.tenant}`, error);
        // Re-throw the error so it's handled by the ActionRegistry and workflow runtime.
        // This ensures the workflow can react to failures appropriately.
        throw error;
      }
    }
  );

  // Placeholder for get_invoice_charges
  actionRegistry.registerSimpleAction(
    'get_invoice_charges',
    'Get invoice items by invoice ID (placeholder)',
    [
      { name: 'invoiceId', type: 'string', required: true },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} get_invoice_charges called for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const items = await knex('invoice_charges')
          .select('invoice_charges.*', 'service_catalog.service_name')
          .leftJoin('service_catalog', 'invoice_charges.service_id', 'service_catalog.service_id')
          .where({ 'invoice_charges.invoice_id': params.invoiceId, 'invoice_charges.tenant': context.tenant });

        logger.info(`${logPrefix} get_invoice_charges: Successfully fetched ${items.length} items for invoiceId: ${params.invoiceId}`);
        return { success: true, items };
      } catch (error: any) {
        logger.error(`${logPrefix} get_invoice_charges: Error fetching items for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Placeholder for get_client
  actionRegistry.registerSimpleAction(
    'get_client',
    'Get a client by ID (placeholder)',
    [
      { name: 'id', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] get_client called for id: ${params.id}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const client = await knex('clients')
          .select('*') // This will fetch address and billing_email if they exist
          .where({ client_id: params.id, tenant: context.tenant })
          .first();

        if (!client) {
          logger.warn(`[ACTION] get_client: Client not found for id: ${params.id}, tenant: ${context.tenant}`);
          const err = new Error(`Client with id ${params.id} not found for tenant ${context.tenant}.`);
          (err as any).status = 404;
          throw err;
        }

        logger.info(`[ACTION] get_client: Successfully fetched client id: ${params.id}`);
        logger.info(`[ACTION] get_client: Client details from DB: ${JSON.stringify(client)}`);

        // Map client_id to alga_client_id for backward compatibility with workflows
        return {
          ...client,
          alga_client_id: client.client_id
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_client: Error fetching client id: ${params.id}, tenant: ${context.tenant}`, error);
        throw error; // Re-throw error
      }
    }
  );

  // Get client default location
  actionRegistry.registerSimpleAction(
    'get_client_default_location',
    'Get the default location for a client',
    [
      { name: 'clientId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] get_client_default_location called for clientId: ${params.clientId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const location = await knex('client_locations')
          .select('*')
          .where({
            client_id: params.clientId,
            tenant: context.tenant,
            is_default: true,
            is_active: true
          })
          .first();

        if (!location) {
          logger.warn(`[ACTION] get_client_default_location: No default location found for client: ${params.clientId}, tenant: ${context.tenant}`);
          return {
            success: true,
            found: false,
            location: null,
            message: `No default location found for client ${params.clientId}`
          };
        }

        logger.info(`[ACTION] get_client_default_location: Successfully fetched default location for client: ${params.clientId}`);

        return {
          success: true,
          found: true,
          location: location
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_client_default_location: Error fetching default location for client: ${params.clientId}, tenant: ${context.tenant}`, error);
        return {
          success: false,
          found: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Get all client locations
  actionRegistry.registerSimpleAction(
    'get_client_locations',
    'Get all active locations for a client',
    [
      { name: 'clientId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] get_client_locations called for clientId: ${params.clientId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const locations = await knex('client_locations')
          .select('*')
          .where({
            client_id: params.clientId,
            tenant: context.tenant,
            is_active: true
          })
          .orderBy('is_default', 'desc')
          .orderBy('location_name', 'asc');

        logger.info(`[ACTION] get_client_locations: Successfully fetched ${locations.length} locations for client: ${params.clientId}`);

        return {
          success: true,
          locations: locations,
          count: locations.length
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_client_locations: Error fetching locations for client: ${params.clientId}, tenant: ${context.tenant}`, error);
        return {
          success: false,
          locations: [],
          count: 0,
          message: error.message,
          error: error
        };
      }
    }
  );
  // Placeholder for trigger_workflow
  actionRegistry.registerSimpleAction(
    'trigger_workflow',
    'Trigger another workflow (placeholder)',
    [
      { name: 'name', type: 'string', required: true },
      { name: 'input', type: 'object', required: true },
      { name: 'correlationId', type: 'string', required: false },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] trigger_workflow called for name: ${params.name}, tenant: ${context.tenant}, correlationId: ${params.correlationId}`, { input: params.input });
      try {
        const { getWorkflowRuntime } = await import('@alga-psa/shared/workflow/core/workflowRuntime');
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        // Determine if the target workflow is system_managed or tenant-specific.
        let isSystemManaged = false;
        let registrationTable = 'workflow_registrations';
        let versionTable = 'workflow_registration_versions';
        let workflowVersionInfo;

        // 1. Attempt to find as a system workflow first
        logger.debug(`[ACTION] trigger_workflow: Checking for system workflow named '${params.name}'`);
        const systemWorkflowCheck = await knex('system_workflow_registrations as reg')
          .join('system_workflow_registration_versions as ver', function(this: any) {
            this.on('reg.registration_id', '=', 'ver.registration_id');
            this.andOn('ver.is_current', '=', knex.raw('?', [true]));
          })
          .where('reg.name', params.name)
          .select('ver.version_id', 'reg.registration_id')
          .first();

        if (systemWorkflowCheck && systemWorkflowCheck.version_id) {
          logger.info(`[ACTION] trigger_workflow: Found system workflow named '${params.name}' with version_id: ${systemWorkflowCheck.version_id}`);
          isSystemManaged = true;
          registrationTable = 'system_workflow_registrations';
          versionTable = 'system_workflow_registration_versions';
          workflowVersionInfo = systemWorkflowCheck;
        } else {
          // 2. If not found as system, try as tenant workflow
          logger.debug(`[ACTION] trigger_workflow: System workflow '${params.name}' not found. Checking for tenant workflow for tenant: ${context.tenant}`);
          const tenantWorkflowCheck = await knex('workflow_registrations as reg')
            .join('workflow_registration_versions as ver', function(this: any) {
              this.on('reg.registration_id', '=', 'ver.registration_id');
              this.andOn('ver.is_current', '=', knex.raw('?', [true]));
              this.andOn('reg.tenant', '=', knex.raw('?', [context.tenant]));
              this.andOn('ver.tenant', '=', knex.raw('?', [context.tenant]));
            })
            .where('reg.name', params.name)
            .select('ver.version_id', 'reg.registration_id')
            .first();

          if (tenantWorkflowCheck && tenantWorkflowCheck.version_id) {
            logger.info(`[ACTION] trigger_workflow: Found tenant workflow named '${params.name}' for tenant ${context.tenant} with version_id: ${tenantWorkflowCheck.version_id}`);
            isSystemManaged = false; // Explicitly false
            workflowVersionInfo = tenantWorkflowCheck;
          }
        }

        if (!workflowVersionInfo || !workflowVersionInfo.version_id) {
          const scopeMessage = isSystemManaged ? "system-wide" : `for tenant: ${context.tenant}`;
          logger.error(`[ACTION] trigger_workflow: Workflow named '${params.name}' not found or has no current version ${scopeMessage}`);
          return { success: false, message: `Workflow named '${params.name}' not found or has no current version ${scopeMessage}.` };
        }

        const workflowRuntime = getWorkflowRuntime(getActionRegistry()); // Pass the action registry

        const result = await workflowRuntime.startWorkflowByVersionId(knex, {
          versionId: workflowVersionInfo.version_id,
          tenant: context.tenant, // Tenant context is still passed, runtime handles it based on isSystemManaged
          initialData: params.input,
          userId: context.userId,
          isSystemManaged: isSystemManaged,
          correlationId: params.correlationId, // Pass correlationId
        });

        logger.info(`[ACTION] trigger_workflow: Successfully triggered workflow '${params.name}' (isSystemManaged: ${isSystemManaged}, correlationId: ${params.correlationId}) with execution ID: ${result.executionId}`);
        return { success: true, triggeredExecutionId: result.executionId, ...result };
      } catch (error: any) {
        logger.error(`[ACTION] trigger_workflow: Error triggering workflow '${params.name}', tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Retired QBO invoice update action
  actionRegistry.registerSimpleAction(
    'update_qbo_invoice',
    'Legacy QBO invoice update action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] update_qbo_invoice invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'update_qbo_invoice is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO invoice creation action
  actionRegistry.registerSimpleAction(
    'create_qbo_invoice',
    'Legacy QBO invoice creation action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] create_qbo_invoice invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'create_qbo_invoice is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO customer creation action
  actionRegistry.registerSimpleAction(
    'create_qbo_customer',
    'Legacy QBO customer creation action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] create_qbo_customer invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'create_qbo_customer is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO customer update action
  actionRegistry.registerSimpleAction(
    'update_qbo_customer',
    'Legacy QBO customer update action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] update_qbo_customer invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'update_qbo_customer is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO customer lookup action
  actionRegistry.registerSimpleAction(
    'get_qbo_customer_by_display_or_email',
    'Legacy QBO customer lookup action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] get_qbo_customer_by_display_or_email invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        customers: [],
        message: 'get_qbo_customer_by_display_or_email is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO customer fetch by ID action
  actionRegistry.registerSimpleAction(
    'get_qbo_customer_by_id',
    'Legacy QBO customer fetch by ID action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] get_qbo_customer_by_id invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        customer: null,
        message: 'get_qbo_customer_by_id is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retired QBO client mapping update action
  actionRegistry.registerSimpleAction(
    'update_client_qbo_details',
    'Legacy QBO client mapping update action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] update_client_qbo_details invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'update_client_qbo_details is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // Retrieves an external entity mapping for an Alga entity, system, and realm.
  actionRegistry.registerSimpleAction(
    'get_external_entity_mapping',
    'Retrieves an external entity mapping for an Alga entity, system, and realm.',
    [
      { name: 'algaEntityId', type: 'string', required: true, description: 'The ID of the Alga entity (e.g., client ID, invoice ID).' },
      { name: 'externalSystemName', type: 'string', required: true, description: 'The name of the external system (e.g., \'quickbooks_online\').' },
      { name: 'externalRealmId', type: 'string', required: true, description: 'The realm ID for the external system (e.g., QBO realmId).' },
      { name: 'algaEntityType', type: 'string', required: false, description: 'The type of Alga entity (e.g., "invoice", "client"). Defaults to "client" if not specified.' }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      const entityType = params.algaEntityType || 'client'; // Default to 'client' for backward compatibility

      logger.info(`${logPrefix} get_external_entity_mapping called for algaEntityType: ${entityType}, algaEntityId: ${params.algaEntityId}, externalSystemName: ${params.externalSystemName}, externalRealmId: ${params.externalRealmId}, tenant: ${context.tenant}`);

      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const mapping = await knex('tenant_external_entity_mappings')
          .select('external_entity_id', 'metadata', 'sync_status')
          .where({
            tenant: context.tenant,
            alga_entity_id: params.algaEntityId,
            alga_entity_type: entityType,
            integration_type: params.externalSystemName,
            external_realm_id: params.externalRealmId,
          })
          .first();

        if (mapping) { // Check if mapping is not null/undefined
          logger.info(`${logPrefix} get_external_entity_mapping: Found mapping for algaEntityId: ${params.algaEntityId}`);
          return {
            success: true,
            found: true,
            mapping: {
              externalEntityId: mapping.external_entity_id,
              syncToken: mapping.metadata?.qboSyncToken, // Get from mapping.metadata
              metadata: mapping.metadata,                 // Return the correct metadata object
              lastSyncStatus: mapping.sync_status // Get from mapping.sync_status
            }
          };
        } else {
          logger.info(`${logPrefix} get_external_entity_mapping: No mapping found for algaEntityId: ${params.algaEntityId}`);
          return { success: true, found: false, mapping: null };
        }
      } catch (error: any) {
        logger.error(`${logPrefix} get_external_entity_mapping: Error retrieving mapping for algaEntityId: ${params.algaEntityId}, tenant: ${context.tenant}`, error);
        return { success: false, found: false, message: error.message, error };
      }
    }
  );

  // Create or update an external entity mapping
  actionRegistry.registerSimpleAction(
    'create_or_update_external_entity_mapping',
    'Create or update an external entity mapping for an Alga entity and external system',
    [
      { name: 'algaEntityType', type: 'string', required: true, description: 'The type of Alga entity (e.g., "invoice", "client").' },
      { name: 'algaEntityId', type: 'string', required: true, description: 'The ID of the Alga entity.' },
      { name: 'externalSystemName', type: 'string', required: true, description: 'The name of the external system (e.g., "quickbooks_online").' },
      { name: 'externalEntityId', type: 'string', required: true, description: 'The ID of the entity in the external system.' },
      { name: 'externalRealmId', type: 'string', required: true, description: 'The realm ID for the external system.' },
      { name: 'metadata', type: 'object', required: false, description: 'Additional metadata for the mapping (e.g., syncToken).' },
      { name: 'tenantId', type: 'string', required: false, description: 'The tenant ID (defaults to context.tenant).' }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} create_or_update_external_entity_mapping called for algaEntityType: ${params.algaEntityType}, algaEntityId: ${params.algaEntityId}, externalSystemName: ${params.externalSystemName}, externalEntityId: ${params.externalEntityId}, externalRealmId: ${params.externalRealmId}, tenant: ${context.tenant}`);

      // Validate required parameters to avoid database errors
      if (!params.externalEntityId) {
        const errorMsg = `Missing required parameter: externalEntityId cannot be null or empty`;
        logger.error(`${logPrefix} create_or_update_external_entity_mapping: ${errorMsg}`);
        return { success: false, message: errorMsg };
      }

      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        // Create timestamp for both created_at and updated_at
        const now = new Date();

        // Include all required fields
        const mappingData = {
          tenant: context.tenant,
          integration_type: params.externalSystemName,
          alga_entity_type: params.algaEntityType,
          alga_entity_id: params.algaEntityId,
          external_entity_id: params.externalEntityId, // Required
          external_realm_id: params.externalRealmId,
          sync_status: 'SYNCED',
          metadata: params.metadata || {},
          created_at: now,
          updated_at: now,
        };

        // Perform an upsert operation
        const conflictTarget = ['tenant', 'integration_type', 'alga_entity_type', 'alga_entity_id'];

        const [updatedMapping] = await knex('tenant_external_entity_mappings')
          .insert(mappingData)
          .onConflict(conflictTarget)
          .merge({
            external_entity_id: params.externalEntityId, // Make sure this is explicitly included
            external_realm_id: params.externalRealmId,  // Include this as well, though it's nullable
            sync_status: 'SYNCED',
            metadata: params.metadata || {},
            updated_at: now,
            last_synced_at: now // Update the last_synced_at timestamp
          })
          .returning('*');

        if (!updatedMapping) {
          logger.warn(`${logPrefix} create_or_update_external_entity_mapping: Mapping not created or updated for algaEntityId: ${params.algaEntityId}, externalEntityId: ${params.externalEntityId}`);
          return { success: false, message: 'Mapping not created or updated.' };
        }

        logger.info(`${logPrefix} create_or_update_external_entity_mapping: Successfully created/updated mapping for entity ${params.algaEntityId} with external ID ${params.externalEntityId}`);
        return { success: true, id: updatedMapping.id };

      } catch (error: any) {
        logger.error(`${logPrefix} create_or_update_external_entity_mapping: Error creating/updating mapping for entity ${params.algaEntityId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Get Secret action
  actionRegistry.registerSimpleAction(
    'get_secret',
    'Retrieves a specified secret for the current tenant, potentially scoped further.',
    [
      { name: 'secretName', type: 'string', required: true, description: 'The logical name of the secret to retrieve (e.g., "QBO_CREDENTIALS", "STRIPE_API_KEY").' },
      { name: 'scopeIdentifier', type: 'string', required: false, description: 'An optional identifier to further scope the secret if needed (e.g., a QBO realmId).' }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const { secretName, scopeIdentifier } = params;
      const { tenant: tenantId, executionId, workflowName } = context;
      const currentSecretName = secretName as string; // Use casted name for clarity
      const currentScopeIdentifier = scopeIdentifier as string | undefined; // Use casted name

      logger.info(
        `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Attempting to retrieve secret: '${currentSecretName}' for tenant: '${tenantId}'${currentScopeIdentifier ? ` with scope: '${currentScopeIdentifier}'` : ''}`
      );

      try {
        const secretProvider = await getSecretProviderInstance();
        const secretString = await secretProvider.getTenantSecret(tenantId, currentSecretName);

        if (secretString === null || secretString === undefined || secretString.trim() === '') {
          logger.warn(
            `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Secret not found or empty: '${currentSecretName}' for tenant: '${tenantId}'`
          );
          return {
            success: false,
            message: `Secret '${currentSecretName}' not found or is empty for tenant '${tenantId}'.`,
          };
        }

        let parsedSecret: any;
        try {
          parsedSecret = JSON.parse(secretString);
        } catch (parseError: any) {
          logger.error(
            `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Error parsing secret: '${currentSecretName}' for tenant: '${tenantId}'. Secret was: "${secretString}". Error: ${parseError.message}`,
            { error: parseError }
          );
          return {
            success: false,
            message: `Error parsing secret '${currentSecretName}'. The secret content is not valid JSON.`,
            error: parseError.message,
          };
        }

        // Handle scopeIdentifier
        if (currentScopeIdentifier) {
          if (typeof parsedSecret === 'object' && parsedSecret !== null) {
            if (Object.prototype.hasOwnProperty.call(parsedSecret, currentScopeIdentifier)) {
              logger.info(
                `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Successfully retrieved and scoped secret: '${currentSecretName}' for tenant: '${tenantId}', scope: '${currentScopeIdentifier}'`
              );
              return {
                success: true,
                secret: parsedSecret[currentScopeIdentifier],
              };
            } else {
              // Scope identifier provided, secret is an object, but scope key not found.
              logger.warn(
                `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Scope '${currentScopeIdentifier}' not found in secret object '${currentSecretName}' for tenant: '${tenantId}'.`
              );
              return {
                success: false,
                message: `Scope '${currentScopeIdentifier}' not found in the secret object for '${currentSecretName}' (tenant: '${tenantId}').`,
              };
            }
          } else {
            // Scope identifier provided, but the secret is not an object (e.g., it's a string, number, boolean).
            // The scopeIdentifier is ignored as per requirements for simple secrets.
            logger.info(
              `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Scope identifier '${currentScopeIdentifier}' provided for non-object secret '${currentSecretName}'. Returning the entire secret as it is not an object. Tenant: '${tenantId}'.`
            );
            // Fall through to return the whole parsedSecret
          }
        }

        // If no scopeIdentifier, or if scopeIdentifier was ignored for non-object secret
        logger.info(
          `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] Successfully retrieved secret: '${currentSecretName}' for tenant: '${tenantId}'.`
        );
        return {
          success: true,
          secret: parsedSecret,
        };

      } catch (error: any) { // Catches errors from getSecretProviderInstance() or getTenantSecret() or other unexpected issues
        logger.error(
          `[ACTION][get_secret][${workflowName || 'UnknownWorkflow'}:${executionId}] General error in get_secret action for secret: '${currentSecretName}' for tenant: '${tenantId}'. Error: ${error.message}`,
          { error }
        );
        return {
          success: false,
          message: `An unexpected error occurred while retrieving secret '${currentSecretName}': ${error.message}`,
          error: error.toString(),
        };
      }
    }
  );

  // Retired QBO invoice detail update action
  actionRegistry.registerSimpleAction(
    'update_invoice_qbo_details',
    'Legacy QBO invoice detail update action (retired)',
    [
      { name: 'payload', type: 'object', required: false }
    ],
    async (_params: Record<string, any>, context: ActionExecutionContext) => {
      logger.warn(`[ACTION] update_invoice_qbo_details invoked after QBO workflow retirement for tenant ${context.tenant}. Returning deprecation notice.`);
      return {
        success: false,
        deprecated: true,
        message: 'update_invoice_qbo_details is no longer available; use AccountingExportService-driven exports for QuickBooks.'
      };
    }
  );

  // === Email Domain Verification Workflow Actions ===

  // Create Resend Domain Action
  actionRegistry.registerSimpleAction(
    'createResendDomain',
    'Create a new domain in Resend for tenant email verification',
    [
      { name: 'tenantId', type: 'string', required: true },
      { name: 'domain', type: 'string', required: true },
      { name: 'region', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] createResendDomain called for domain: ${params.domain}, tenant: ${params.tenantId}`);

      try {
        // For now, return a mock response until we implement the actual Resend provider
        // This will be replaced when we implement the ResendEmailProvider
        const mockResult = {
          resendDomainId: `rd_${Date.now()}`,
          domain: params.domain,
          status: 'pending',
          region: params.region || 'us-east-1',
          dnsRecords: [
            {
              type: 'TXT',
              name: `resend._domainkey.${params.domain}`,
              value: 'mock-dkim-key-value'
            },
            {
              type: 'TXT',
              name: `send.${params.domain}`,
              value: 'v=spf1 include:resend.net ~all'
            },
            {
              type: 'MX',
              name: `send.${params.domain}`,
              value: '10 feedback-smtp.us-east-1.amazonses.com'
            }
          ]
        };

        logger.info(`[ACTION] createResendDomain: Mock domain created with ID: ${mockResult.resendDomainId}`);
        return { success: true, ...mockResult };
      } catch (error: any) {
        logger.error(`[ACTION] createResendDomain: Error creating domain ${params.domain}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Send DNS Instructions Action
  actionRegistry.registerSimpleAction(
    'sendDNSInstructions',
    'Send DNS configuration instructions to tenant',
    [
      { name: 'tenantId', type: 'string', required: true },
      { name: 'domain', type: 'string', required: true },
      { name: 'dnsRecords', type: 'object', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] sendDNSInstructions called for domain: ${params.domain}, tenant: ${params.tenantId}`);

      try {
        // For now, just log the DNS instructions
        // In a real implementation, this would send an email or create a notification
        logger.info(`[ACTION] sendDNSInstructions: DNS records for ${params.domain}:`, params.dnsRecords);

        // Mock success response
        return {
          success: true,
          notificationSent: true,
          message: `DNS instructions sent for domain ${params.domain}`
        };
      } catch (error: any) {
        logger.error(`[ACTION] sendDNSInstructions: Error sending DNS instructions for ${params.domain}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Trigger Domain Verification Action
  actionRegistry.registerSimpleAction(
    'triggerDomainVerification',
    'Trigger domain verification check in Resend',
    [
      { name: 'tenantId', type: 'string', required: true },
      { name: 'resendDomainId', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] triggerDomainVerification called for resendDomainId: ${params.resendDomainId}, tenant: ${params.tenantId}`);

      try {
        // For now, return a mock response
        // In a real implementation, this would call the Resend API to verify the domain
        const mockStatuses = ['pending', 'verified', 'failed'];
        const randomStatus = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];

        const result = {
          status: randomStatus,
          resendDomainId: params.resendDomainId,
          verifiedAt: randomStatus === 'verified' ? new Date().toISOString() : null,
          failureReason: randomStatus === 'failed' ? 'DNS records not found' : null
        };

        logger.info(`[ACTION] triggerDomainVerification: Domain verification status: ${result.status}`);
        return { success: true, ...result };
      } catch (error: any) {
        logger.error(`[ACTION] triggerDomainVerification: Error verifying domain ${params.resendDomainId}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Activate Custom Domain Action
  actionRegistry.registerSimpleAction(
    'activateCustomDomain',
    'Activate a verified custom domain for tenant email sending',
    [
      { name: 'tenantId', type: 'string', required: true },
      { name: 'domain', type: 'string', required: true },
      { name: 'resendDomainId', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] activateCustomDomain called for domain: ${params.domain}, tenant: ${params.tenantId}`);

      try {
        // For now, just log the activation
        // In a real implementation, this would update tenant email settings in the database
        logger.info(`[ACTION] activateCustomDomain: Activating domain ${params.domain} for tenant ${params.tenantId}`);

        return {
          success: true,
          domainActivated: true,
          domain: params.domain,
          resendDomainId: params.resendDomainId
        };
      } catch (error: any) {
        logger.error(`[ACTION] activateCustomDomain: Error activating domain ${params.domain}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Send Domain Verification Success Notification Action
  actionRegistry.registerSimpleAction(
    'sendDomainVerificationSuccess',
    'Send success notification to tenant about domain verification',
    [
      { name: 'tenantId', type: 'string', required: true },
      { name: 'domain', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] sendDomainVerificationSuccess called for domain: ${params.domain}, tenant: ${params.tenantId}`);

      try {
        // For now, just log the success notification
        // In a real implementation, this would send an email or create a notification
        logger.info(`[ACTION] sendDomainVerificationSuccess: Domain ${params.domain} successfully verified for tenant ${params.tenantId}`);

        return {
          success: true,
          notificationSent: true,
          message: `Success notification sent for domain ${params.domain}`
        };
      } catch (error: any) {
        logger.error(`[ACTION] sendDomainVerificationSuccess: Error sending success notification for ${params.domain}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // === Email Processing Workflow Actions ===

  // Register all email workflow actions that bridge to server actions
  registerEmailWorkflowActions(actionRegistry);
}

/**
 * Register email workflow actions that bridge to server actions
 * @param actionRegistry The action registry to register with
 */
function registerEmailWorkflowActions(actionRegistry: ActionRegistry): void {
  logger.info('[WorkflowInit] Starting registration of email workflow actions...');

  // Email Contact Actions
  actionRegistry.registerSimpleAction(
    'find_contact_by_email',
    'Find a contact by email address',
    [{ name: 'email', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import from shared workflow actions module
        const { findContactByEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const contact = await findContactByEmail(params.email, context.tenant);

        return {
          success: !!contact,
          contact: contact
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_contact_by_email: Error finding contact for email ${params.email}`, error);
        return {
          success: false,
          contact: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'create_or_find_contact',
    'Create or find contact by email and client',
    [
      { name: 'email', type: 'string', required: true },
      { name: 'name', type: 'string', required: false },
      { name: 'client_id', type: 'string', required: true },
      { name: 'phone', type: 'string', required: false },
      { name: 'title', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createOrFindContact } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createOrFindContact({
          email: params.email,
          name: params.name,
          client_id: params.client_id,
          phone: params.phone,
          title: params.title
        }, context.tenant);

        return {
          success: true,
          contact: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_or_find_contact: Error creating/finding contact for email ${params.email}`, error);
        return {
          success: false,
          contact: null,
          message: error.message
        };
      }
    }
  );

  // Email Threading Actions
  actionRegistry.registerSimpleAction(
    'find_ticket_by_email_thread',
    'Find existing ticket by email thread information',
    [
      { name: 'threadId', type: 'string', required: false },
      { name: 'inReplyTo', type: 'string', required: false },
      { name: 'references', type: 'object', required: false },
      { name: 'originalMessageId', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { findTicketByEmailThread } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const ticket = await findTicketByEmailThread(params, context.tenant);

        return {
          success: !!ticket,
          ticket: ticket
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_ticket_by_email_thread: Error finding ticket thread`, error);
        return {
          success: false,
          ticket: null,
          message: error.message
        };
      }
    }
  );

  // Email Ticket Actions
  actionRegistry.registerSimpleAction(
    'create_ticket_from_email',
    'Create a ticket from email data',
    [
      { name: 'title', type: 'string', required: true },
      { name: 'description', type: 'string', required: true },
      { name: 'client_id', type: 'string', required: false },
      { name: 'contact_id', type: 'string', required: false },
      { name: 'source', type: 'string', required: false },
      { name: 'board_id', type: 'string', required: false },
      { name: 'status_id', type: 'string', required: false },
      { name: 'priority_id', type: 'string', required: false },
      { name: 'category_id', type: 'string', required: false },
      { name: 'subcategory_id', type: 'string', required: false },
      { name: 'location_id', type: 'string', required: false },
      { name: 'entered_by', type: 'string', required: false },
      { name: 'email_metadata', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createTicketFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createTicketFromEmail({
          title: params.title,
          description: params.description,
          client_id: params.client_id,
          contact_id: params.contact_id,
          source: params.source,
          board_id: params.board_id,
          status_id: params.status_id,
          priority_id: params.priority_id,
          category_id: params.category_id,
          subcategory_id: params.subcategory_id,
          location_id: params.location_id,
          entered_by: params.entered_by,
          email_metadata: params.email_metadata
        }, context.tenant);

        return {
          success: true,
          ticket_id: result.ticket_id,
          ticket_number: result.ticket_number
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_ticket_from_email: Error creating ticket from email`, error);
        return {
          success: false,
          ticket_id: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'resolve_inbound_ticket_defaults',
    'Resolve inbound ticket defaults (provider-specific required)',
    [
      { name: 'tenant', type: 'string', required: true },
      { name: 'providerId', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { resolveInboundTicketDefaults } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const defaults = await resolveInboundTicketDefaults(params.tenant, params.providerId);

        return defaults;
      } catch (error: any) {
        logger.error(`[ACTION] resolve_inbound_ticket_defaults: Error resolving defaults for tenant ${params.tenant}`, error);
        return null;
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'create_comment_from_email',
    'Create a comment from email data',
    [
      { name: 'ticket_id', type: 'string', required: true },
      { name: 'content', type: 'string', required: true },
      { name: 'format', type: 'string', required: false },
      { name: 'source', type: 'string', required: false },
      { name: 'author_type', type: 'string', required: false },
      { name: 'author_id', type: 'string', required: false },
      { name: 'metadata', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createCommentFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const commentId = await createCommentFromEmail({
          ticket_id: params.ticket_id,
          content: params.content,
          format: params.format,
          source: params.source,
          author_type: params.author_type,
          author_id: params.author_id,
          metadata: params.metadata
        }, context.tenant);

        return {
          success: true,
          comment_id: commentId
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_comment_from_email: Error creating comment from email`, error);
        return {
          success: false,
          comment_id: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'parse_email_reply',
    'Parse inbound email reply content using heuristics',
    [
      { name: 'text', type: 'string', required: false },
      { name: 'html', type: 'string', required: false },
      { name: 'config', type: 'object', required: false }
    ],
    async (params: Record<string, any>) => {
      try {
        const { parseEmailReplyBody } = await import('@shared/workflow/actions/emailWorkflowActions');
        const parsed = await parseEmailReplyBody({
          text: params.text,
          html: params.html
        }, params.config);

        return {
          success: true,
          parsed
        };
      } catch (error: any) {
        logger.error('[ACTION] parse_email_reply: Failed to parse inbound email', error);
        return {
          success: false,
          parsed: null,
          message: error?.message || 'Failed to parse email body'
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'find_ticket_by_reply_token',
    'Find a ticket using a stored email reply token',
    [
      { name: 'token', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { findTicketByReplyToken } = await import('@shared/workflow/actions/emailWorkflowActions');
        const match = await findTicketByReplyToken(params.token, context.tenant);

        return {
          success: !!match,
          match
        };
      } catch (error: any) {
        logger.error('[ACTION] find_ticket_by_reply_token: Error looking up reply token', error);
        return {
          success: false,
          match: null,
          message: error?.message || 'Failed to locate reply token'
        };
      }
    }
  );

  // Email Attachment Actions
  actionRegistry.registerSimpleAction(
    'process_email_attachment',
    'Process email attachment and associate with ticket',
    [
      { name: 'emailId', type: 'string', required: true },
      { name: 'attachmentId', type: 'string', required: true },
      { name: 'ticketId', type: 'string', required: true },
      { name: 'tenant', type: 'string', required: true },
      { name: 'providerId', type: 'string', required: true },
      { name: 'attachmentData', type: 'object', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { processEmailAttachment } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        // Note: tenant is already in params for this action
        const result = await processEmailAttachment({
          emailId: params.emailId,
          attachmentId: params.attachmentId,
          ticketId: params.ticketId,
          tenant: params.tenant,
          providerId: params.providerId,
          attachmentData: params.attachmentData
        }, context.tenant);

        return {
          success: result.success,
          documentId: result.documentId,
          fileName: result.fileName,
          fileSize: result.fileSize,
          contentType: result.contentType
        };
      } catch (error: any) {
        logger.error(`[ACTION] process_email_attachment: Error processing attachment ${params.attachmentId}`, error);
        return {
          success: false,
          documentId: null,
          message: error.message
        };
      }
    }
  );

  // Email Client Actions
  actionRegistry.registerSimpleAction(
    'create_client_from_email',
    'Create a client from email data',
    [
      { name: 'client_name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
      { name: 'source', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createClientFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createClientFromEmail({
          client_name: params.client_name,
          email: params.email,
          source: params.source
        }, context.tenant);

        return {
          success: true,
          client: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_client_from_email: Error creating client ${params.client_name}`, error);
        return {
          success: false,
          client: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'get_client_by_id_for_email',
    'Get client by ID for email workflows',
    [{ name: 'clientId', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { getClientByIdForEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const client = await getClientByIdForEmail(params.clientId, context.tenant);

        return {
          success: !!client,
          client: client
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_client_by_id_for_email: Error getting client ${params.clientId}`, error);
        return {
          success: false,
          client: null,
          message: error.message
        };
      }
    }
  );

  // Email Board Actions
  actionRegistry.registerSimpleAction(
    'find_board_by_name',
    'Find a board by name',
    [{ name: 'name', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import the database connection
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        let board = await knex('boards')
          .select('board_id as id', 'board_name as name', 'description', 'is_default')
          .where({ tenant: context.tenant, board_name: params.name })
          .andWhere('is_inactive', false)
          .first();
        if (!board) {
          // Fallback: default active board, else first active by display_order
          board = await knex('boards')
            .select('board_id as id', 'board_name as name', 'description', 'is_default')
            .where({ tenant: context.tenant })
            .andWhere('is_inactive', false)
            .andWhere('is_default', true)
            .first();
          if (!board) {
            board = await knex('boards')
              .select('board_id as id', 'board_name as name', 'description', 'is_default')
              .where({ tenant: context.tenant })
              .andWhere('is_inactive', false)
              .orderBy('display_order', 'asc')
              .first();
          }
          if (!board) {
            logger.warn(`[ACTION] find_board_by_name: No active board found for tenant=${context.tenant}, name='${params.name}'`);
          }
        }

        return {
          success: !!board,
          board: board
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_board_by_name: Error finding board ${params.name}`, error);
        return {
          success: false,
          board: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'create_board_from_email',
    'Create a board from email data',
    [
      { name: 'board_name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'is_default', type: 'boolean', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createBoardFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createBoardFromEmail({
          board_name: params.board_name,
          description: params.description,
          is_default: params.is_default
        }, context.tenant);

        return {
          success: true,
          board: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_board_from_email: Error creating board ${params.board_name}`, error);
        return {
          success: false,
          board: null,
          message: error.message
        };
      }
    }
  );

  // Email Status and Priority Actions
  actionRegistry.registerSimpleAction(
    'find_status_by_name',
    'Find a status by name',
    [
      { name: 'name', type: 'string', required: true },
      { name: 'item_type', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const query = knex('statuses')
          .select('status_id as id', 'name', 'item_type', 'is_closed')
          .where({ tenant: context.tenant, name: params.name });

        if (params.item_type) {
          query.where('item_type', params.item_type);
        }

        let status = await query.first();
        if (!status) {
          // Fallback: default status for item_type (or 'ticket'), else first by order_number
          const itemType = params.item_type || 'ticket';
          status = await knex('statuses')
            .select('status_id as id', 'name', 'item_type', 'is_closed')
            .where({ tenant: context.tenant, item_type: itemType })
            .andWhere('is_default', true)
            .first();
          if (!status) {
            status = await knex('statuses')
              .select('status_id as id', 'name', 'item_type', 'is_closed')
              .where({ tenant: context.tenant, item_type: itemType })
              .orderBy('order_number', 'asc')
              .first();
          }
          if (!status) {
            const it = params.item_type ? `, item_type='${params.item_type}'` : '';
            logger.warn(`[ACTION] find_status_by_name: No status found for tenant=${context.tenant}, name='${params.name}'${it}`);
          }
        }

        return {
          success: !!status,
          status: status
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_status_by_name: Error finding status ${params.name}`, error);
        return {
          success: false,
          status: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'find_priority_by_name',
    'Find a priority by name',
    [{ name: 'name', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        let priority = await knex('priorities')
          .select('priority_id as id', 'priority_name as name', 'order_number', 'color', 'item_type')
          .where({ tenant: context.tenant, priority_name: params.name })
          .first();
        if (!priority) {
          // Fallback: first ticket priority by order_number
          priority = await knex('priorities')
            .select('priority_id as id', 'priority_name as name', 'order_number', 'color', 'item_type')
            .where({ tenant: context.tenant, item_type: 'ticket' })
            .orderBy('order_number', 'asc')
            .first();
          if (!priority) {
            logger.warn(`[ACTION] find_priority_by_name: No priority found for tenant=${context.tenant}, name='${params.name}'`);
          }
        }

        return {
          success: !!priority,
          priority: priority
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_priority_by_name: Error finding priority ${params.name}`, error);
        return {
          success: false,
          priority: null,
          message: error.message
        };
      }
    }
  );

  // Email Client Association Actions
  actionRegistry.registerSimpleAction(
    'save_email_client_association',
    'Save email-to-client association',
    [
      { name: 'email', type: 'string', required: true },
      { name: 'client_id', type: 'string', required: true },
      { name: 'contact_id', type: 'string', required: false },
      { name: 'confidence_score', type: 'number', required: false },
      { name: 'notes', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { saveEmailClientAssociation } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await saveEmailClientAssociation({
          email: params.email,
          client_id: params.client_id,
          contact_id: params.contact_id,
          confidence_score: params.confidence_score,
          notes: params.notes
        }, context.tenant);

        return {
          success: result.success,
          associationId: result.associationId,
          email: result.email,
          client_id: result.client_id
        };
      } catch (error: any) {
        logger.error(`[ACTION] save_email_client_association: Error saving association for ${params.email}`, error);
        return {
          success: false,
          associationId: null,
          message: error.message
        };
      }
    }
  );

  logger.info('[WorkflowInit] Email workflow actions registered successfully');
}

/**
 * Register task inbox actions
 * @param actionRegistry The action registry to register with
 */
function registerTaskInboxActions(actionRegistry: ActionRegistry): void {
  const taskInboxService = getTaskInboxService();
  taskInboxService.registerTaskActions(actionRegistry);
  logger.info('[WorkflowInit] Task inbox actions registered, including inline form support');
}
