/**
 * Shared module for registering workflow actions
 * This file contains all the action registration logic and can be called
 * from both the server and the workflow-worker
 */

import { getActionRegistry, type ActionRegistry, type ActionExecutionContext } from '@shared/workflow/core/index.js';
import logger from '@shared/core/logger.js';
import { getTaskInboxService } from '@shared/workflow/core/taskInboxService.js';
import axios from 'axios'; // For QBO API calls
import { getSecretProviderInstance } from 'server/src/lib/secrets';

// --- Mock Secret Retrieval ---


// --- QBO Helper Types and Constants ---
const QBO_BASE_URL = process.env.QBO_API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

interface QboCredentials {
  accessToken: string;
  refreshToken?: string; // Optional, as not all flows might expose it directly here
  realmId: string; // Already a param in actions, but good to have in a credentials object
  accessTokenExpiresAt: string; // ISO string
  // refreshTokenExpiresAt?: string; // ISO string, optional
}

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
      logger.info(`[ACTION] get_invoice called for id: ${params.id}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@shared/db/admin.js');
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

  // Placeholder for get_invoice_items
  actionRegistry.registerSimpleAction(
    'get_invoice_items',
    'Get invoice items by invoice ID (placeholder)',
    [
      { name: 'invoiceId', type: 'string', required: true },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} get_invoice_items called for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const items = await knex('invoice_items')
          .select('*')
          .where({ invoice_id: params.invoiceId, tenant: context.tenant });
          
        logger.info(`${logPrefix} get_invoice_items: Successfully fetched ${items.length} items for invoiceId: ${params.invoiceId}`);
        return { success: true, items };
      } catch (error: any) {
        logger.error(`${logPrefix} get_invoice_items: Error fetching items for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
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
      logger.info(`[ACTION] get_company called for id: ${params.id}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const company = await knex('companies')
          .select('*')
          .where({ company_id: params.id, tenant: context.tenant }) // Corrected column name
          .first();
          
        if (!company) {
          logger.warn(`[ACTION] get_company: Company not found for id: ${params.id}, tenant: ${context.tenant}`);
          // Throw error if not found, consistent with get_invoice
          const err = new Error(`Company with id ${params.id} not found for tenant ${context.tenant}.`);
          (err as any).status = 404;
          throw err;
        }
        
        logger.info(`[ACTION] get_company: Successfully fetched company id: ${params.id}`);
        logger.info(`[ACTION] get_company: Company details from DB: ${JSON.stringify(company)}`);

        // Return the raw database object directly
        return company;
      } catch (error: any) {
        logger.error(`[ACTION] get_company: Error fetching company id: ${params.id}, tenant: ${context.tenant}`, error);
        throw error; // Re-throw error
      }
    }
  );

  // Placeholder for lookup_qbo_item_id
  actionRegistry.registerSimpleAction(
    'lookup_qbo_item_id',
    'Lookup QBO item ID by Alga product ID (placeholder)',
    [
      { name: 'algaProductId', type: 'string', required: true },
      { name: 'realmId', type: 'string', required: true },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] lookup_qbo_item_id called for algaProductId: ${params.algaProductId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const mapping = await knex('product_qbo_item_mappings')
          .select('qbo_item_id')
          .where({
            alga_product_id: params.algaProductId,
            realm_id: params.realmId, // Using params.realmId for DB lookup as it's specific to the mapping
            tenant: context.tenant
          })
          .first();
          
        if (mapping && mapping.qbo_item_id) {
          logger.info(`[ACTION] lookup_qbo_item_id: Found QBO item ID: ${mapping.qbo_item_id} for Alga product ID: ${params.algaProductId} via DB mapping.`);
          return { success: true, found: true, qboItemId: mapping.qbo_item_id, source: 'database' };
        }
        
        // Option 2: Call QBO API if not found in mapping table
        logger.info(`[ACTION] lookup_qbo_item_id: Alga product ID ${params.algaProductId} not found in DB mapping. Attempting QBO API lookup by name.`);
        
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`[ACTION] lookup_qbo_item_id: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, found: false, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`[ACTION] lookup_qbo_item_id: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, found: false, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`[ACTION] lookup_qbo_item_id: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, found: false, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }

        // QBO API usually queries by DisplayName for items. Assuming algaProductId can be used as a name.
        // Note: QBO Item names are not guaranteed unique by default. This might return multiple items or the first match.
        // A more robust lookup might involve SKUs if Alga Product ID maps to a QBO Item SKU.
        const query = `SELECT Id, Name FROM Item WHERE Name = '${params.algaProductId.replace(/'/g, "\\'")}' MAXRESULTS 1`; // Escape single quotes
        // API calls use params.realmId as the primary realmId for the endpoint
        const queryUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/query?query=${encodeURIComponent(query)}&minorversion=69`;

        logger.debug(`[ACTION] lookup_qbo_item_id: Querying QBO: ${queryUrl}`);

        const response = await axios.get(queryUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`, // Using accessToken from params.qboCredentials
            'Accept': 'application/json',
          },
          timeout: 15000,
        });

        const qboApiItems = response.data?.QueryResponse?.Item;
        if (qboApiItems && qboApiItems.length > 0) {
          const qboItem = qboApiItems[0];
          logger.info(`[ACTION] lookup_qbo_item_id: Found QBO Item via API: ID ${qboItem.Id}, Name ${qboItem.Name} for Alga Product ID ${params.algaProductId}`);
          // Optionally, store this mapping back to your product_qbo_item_mappings table here.
          return { success: true, found: true, qboItemId: qboItem.Id, source: 'qbo_api' };
        }

        logger.warn(`[ACTION] lookup_qbo_item_id: QBO item ID not found via API for Alga product ID: ${params.algaProductId}, realmId: ${params.realmId}`);
        return { success: false, found: false, message: `QBO item ID not found via API for Alga product ID ${params.algaProductId}.` };
        
      } catch (error: any) {
        logger.error(`[ACTION] lookup_qbo_item_id: Error looking up QBO item ID for Alga product ID: ${params.algaProductId}, tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const errorMessage = axios.isAxiosError(error) ? error.response?.data?.Fault?.Error?.[0]?.Detail || error.message : error.message;
        return { success: false, message: `QBO API Error: ${errorMessage}`, errorDetails: error.response?.data || error };
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
        const { getWorkflowRuntime } = await import('@shared/workflow/core/workflowRuntime.js');
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Determine if the target workflow is system_managed or tenant-specific.
        let isSystemManaged = false;
        let registrationTable = 'workflow_registrations';
        let versionTable = 'workflow_registration_versions';
        let workflowVersionInfo;

        // 1. Attempt to find as a system workflow first
        logger.debug(`[ACTION] trigger_workflow: Checking for system workflow named '${params.name}'`);
        const systemWorkflowCheck = await knex('system_workflow_registrations as reg')
          .join('system_workflow_registration_versions as ver', function() {
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
            .join('workflow_registration_versions as ver', function() {
              this.on('reg.registration_id', '=', 'ver.registration_id');
              this.andOn('ver.is_current', '=', knex.raw('?', [true]));
              this.andOn('reg.tenant_id', '=', knex.raw('?', [context.tenant]));
              this.andOn('ver.tenant_id', '=', knex.raw('?', [context.tenant]));
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

  // Placeholder for update_qbo_invoice
  actionRegistry.registerSimpleAction(
    'update_qbo_invoice',
    'Update an existing QBO invoice (placeholder)',
    [
      { name: 'qboInvoiceData', type: 'object', required: true },
      { name: 'qboInvoiceId', type: 'string', required: true },
      { name: 'qboSyncToken', type: 'string', required: true },
      { name: 'realmId', type: 'string', required: true },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] update_qbo_invoice called for qboInvoiceId: ${params.qboInvoiceId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);
      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`[ACTION] update_qbo_invoice: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`[ACTION] update_qbo_invoice: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`[ACTION] update_qbo_invoice: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }

        const invoiceToUpdatePayload = {
          ...params.qboInvoiceData,
          Id: params.qboInvoiceId,
          SyncToken: params.qboSyncToken,
          sparse: true, // Important for QBO updates
        };
        
        const apiUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/invoice?operation=update&minorversion=69`;
        logger.debug(`[ACTION] update_qbo_invoice: Posting to QBO: ${apiUrl}`, invoiceToUpdatePayload);

        const response = await axios.post(apiUrl, invoiceToUpdatePayload, {
          headers: {
            'Authorization': `Bearer ${accessToken}`, // Using accessToken from params.qboCredentials
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000, // Longer timeout for create/update operations
        });

        const qboResponseData = response.data?.Invoice;
        if (!qboResponseData || !qboResponseData.Id) {
            logger.error(`[ACTION] update_qbo_invoice: QBO API response did not contain expected Invoice data. Tenant: ${context.tenant}, QBO Invoice ID: ${params.qboInvoiceId}`, response.data);
            return { success: false, message: 'QBO API response malformed or missing Invoice data after update.', qboRawResponse: response.data };
        }
        
        logger.info(`[ACTION] update_qbo_invoice: Successfully updated QBO invoice ${qboResponseData.Id}. New SyncToken: ${qboResponseData.SyncToken}`);
        return { success: true, qboResponse: qboResponseData };
        
      } catch (error: any) {
        logger.error(`[ACTION] update_qbo_invoice: Error updating QBO invoice ${params.qboInvoiceId}, realmId: ${params.realmId}, tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const errorMessage = axios.isAxiosError(error) ? error.response?.data?.Fault?.Error?.[0]?.Detail || error.message : error.message;
        return { success: false, message: `QBO API Error: ${errorMessage}`, errorDetails: error.response?.data || error };
      }
    }
  );

  // Placeholder for create_qbo_invoice
  actionRegistry.registerSimpleAction(
    'create_qbo_invoice',
    'Create a new QBO invoice (placeholder)',
    [
      { name: 'qboInvoiceData', type: 'object', required: true },
      { name: 'realmId', type: 'string', required: true },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] create_qbo_invoice called for realmId: ${params.realmId}, tenant: ${context.tenant}`);
      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`[ACTION] create_qbo_invoice: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`[ACTION] create_qbo_invoice: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`[ACTION] create_qbo_invoice: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }
        
        // params.qboInvoiceData should be the complete QBO Invoice object structure for creation
        const invoiceToCreatePayload = { ...params.qboInvoiceData };
        
        const apiUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/invoice?minorversion=69`;
        logger.debug(`[ACTION] create_qbo_invoice: Posting to QBO: ${apiUrl}`, invoiceToCreatePayload);

        const response = await axios.post(apiUrl, invoiceToCreatePayload, {
          headers: {
            'Authorization': `Bearer ${accessToken}`, // Using accessToken from params.qboCredentials
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
        
        const qboResponseData = response.data?.Invoice;
        if (!qboResponseData || !qboResponseData.Id) {
            logger.error(`[ACTION] create_qbo_invoice: QBO API response did not contain expected Invoice data. Tenant: ${context.tenant}`, response.data);
            return { success: false, message: 'QBO API response malformed or missing Invoice data after creation.', qboRawResponse: response.data };
        }

        logger.info(`[ACTION] create_qbo_invoice: Successfully created QBO invoice. New ID: ${qboResponseData.Id}, SyncToken: ${qboResponseData.SyncToken}`);
        return { success: true, qboResponse: qboResponseData };
        
      } catch (error: any) {
        logger.error(`[ACTION] create_qbo_invoice: Error creating QBO invoice, realmId: ${params.realmId}, tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const errorMessage = axios.isAxiosError(error) ? error.response?.data?.Fault?.Error?.[0]?.Detail || error.message : error.message;
        return { success: false, message: `QBO API Error: ${errorMessage}`, errorDetails: error.response?.data || error };
      }
    }
  );

  // Create QBO Customer
  actionRegistry.registerSimpleAction(
    'create_qbo_customer',
    'Create a new QBO Customer',
    [
      { name: 'qboCustomerData', type: 'object', required: true }, // This should be the QBO Customer object
      { name: 'realmId', type: 'string', required: true },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} create_qbo_customer called for realmId: ${params.realmId}, tenant: ${context.tenant}`);

      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`${logPrefix} create_qbo_customer: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, Customer: null, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`${logPrefix} create_qbo_customer: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, Customer: null, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`${logPrefix} create_qbo_customer: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, Customer: null, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }
        
        const customerToCreatePayload = { ...params.qboCustomerData };
        
        const apiUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/customer?minorversion=69`;
        logger.debug(`${logPrefix} create_qbo_customer: Posting to QBO: ${apiUrl}`, customerToCreatePayload);

        const response = await axios.post(apiUrl, customerToCreatePayload, {
          headers: {
            'Authorization': `Bearer ${accessToken}`, // Using accessToken from params.qboCredentials
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
        
        const qboResponseData = response.data?.Customer; // QBO typically returns the created object under a 'Customer' key
        if (!qboResponseData || !qboResponseData.Id) {
            logger.error(`${logPrefix} create_qbo_customer: QBO API response did not contain expected Customer data. Tenant: ${context.tenant}`, response.data);
            return { success: false, Customer: null, message: 'QBO API response malformed or missing Customer data after creation.', qboRawResponse: response.data };
        }

        logger.info(`${logPrefix} create_qbo_customer: Successfully created QBO Customer. New ID: ${qboResponseData.Id}, SyncToken: ${qboResponseData.SyncToken}`);
        // Return a structure that includes the Customer object, similar to QBO's API response structure
        return { success: true, Customer: qboResponseData };
        
      } catch (error: any) {
        logger.error(`${logPrefix} create_qbo_customer: Error creating QBO Customer, realmId: ${params.realmId}, tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const errorMessage = axios.isAxiosError(error) ? error.response?.data?.Fault?.Error?.[0]?.Detail || error.message : error.message;
        // Return a structure indicating failure, including the error message
        return { success: false, Customer: null, message: `QBO API Error: ${errorMessage}`, errorDetails: error.response?.data || error };
      }
    }
  );

  // Update QBO Customer
  actionRegistry.registerSimpleAction(
    'update_qbo_customer',
    'Update an existing QBO Customer',
    [
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
      { name: 'qboCustomerId', type: 'string', required: true, description: 'The ID of the QBO customer to update.' },
      { name: 'qboSyncToken', type: 'string', required: true, description: 'The SyncToken for the QBO customer update.' },
      { name: 'qboCustomerData', type: 'object', required: true, description: 'The QBO customer data object containing fields to update (excluding Id and SyncToken).' },
      { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID.' },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} update_qbo_customer called for qboCustomerId: ${params.qboCustomerId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);

      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`${logPrefix} update_qbo_customer: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, Customer: null, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`${logPrefix} update_qbo_customer: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, Customer: null, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`${logPrefix} update_qbo_customer: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, Customer: null, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }
        
        const customerToUpdatePayload = {
          ...params.qboCustomerData, // Spread the customer data first
          Id: params.qboCustomerId,    // Add/override Id
          SyncToken: params.qboSyncToken, // Add/override SyncToken
          sparse: true,                // Ensure sparse update is true
        };
        
        const apiUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/customer?operation=update&minorversion=69`;
        logger.debug(`${logPrefix} update_qbo_customer: Posting to QBO: ${apiUrl}`, JSON.stringify(customerToUpdatePayload));

        const response = await axios.post(apiUrl, customerToUpdatePayload, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000, // Standard timeout for update operations
        });
        
        const qboResponseData = response.data?.Customer;
        if (!qboResponseData || !qboResponseData.Id || !qboResponseData.SyncToken) {
            logger.error(`${logPrefix} update_qbo_customer: QBO API response did not contain expected Customer data (Id, SyncToken). Tenant: ${context.tenant}, QBO Customer ID: ${params.qboCustomerId}`, response.data);
            return { success: false, Customer: null, message: 'QBO API response malformed or missing Customer Id/SyncToken after update.', qboRawResponse: response.data };
        }

        logger.info(`${logPrefix} update_qbo_customer: Successfully updated QBO Customer. ID: ${qboResponseData.Id}, New SyncToken: ${qboResponseData.SyncToken}`);
        return { success: true, Customer: { Id: qboResponseData.Id, SyncToken: qboResponseData.SyncToken } }; // Return only Id and SyncToken as specified
        
      } catch (error: any) {
        logger.error(`${logPrefix} update_qbo_customer: Error updating QBO Customer ${params.qboCustomerId}, realmId: ${params.realmId}, tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const faultError = error.response?.data?.Fault?.Error?.[0];
        let errorMessage = 'An unexpected error occurred during QBO customer update.';
        if (faultError) {
          errorMessage = `QBO API Error: ${faultError.Message || 'Unknown QBO Error'}. Detail: ${faultError.Detail || 'No additional details.'} Code: ${faultError.code || 'N/A'}`;
        } else if (axios.isAxiosError(error) && error.message) {
            errorMessage = `Network/Request Error: ${error.message}`;
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        return { success: false, Customer: null, message: errorMessage, errorDetails: error.response?.data || error.toString() };
      }
    }
  );
  
  // Get QBO Customer by DisplayName or Email
  actionRegistry.registerSimpleAction(
    'get_qbo_customer_by_display_or_email',
    'Get QBO Customer(s) by DisplayName or Email Address',
    [
      { name: 'displayName', type: 'string', required: false },
      { name: 'email', type: 'string', required: false },
      { name: 'realmId', type: 'string', required: true },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
      // tenantId is implicitly available in ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} get_qbo_customer_by_display_or_email called for realmId: ${params.realmId}, tenant: ${context.tenant}`, { displayName: params.displayName, email: params.email });

      if (!params.displayName && !params.email) {
        logger.warn(`${logPrefix} get_qbo_customer_by_display_or_email: Either displayName or email must be provided.`);
        return { success: false, found: false, customers: [], message: 'Either displayName or email must be provided.' };
      }

      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`${logPrefix} get_qbo_customer_by_display_or_email: QBO credentials not provided for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, found: false, customers: [], message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`${logPrefix} get_qbo_customer_by_display_or_email: Missing QBO accessToken or accessTokenExpiresAt in provided credentials for tenant ${context.tenant}, realm ${params.realmId}.`);
          return { success: false, found: false, customers: [], message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing in provided credentials).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`${logPrefix} get_qbo_customer_by_display_or_email: QBO access token expired for tenant ${context.tenant}, realm ${params.realmId} (using provided credentials). Needs refresh.`);
          return { success: false, found: false, customers: [], message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }

        let queryConditions: string[] = [];
        if (params.displayName) {
          queryConditions.push(`DisplayName = '${params.displayName.replace(/'/g, "\\'")}'`);
        }
        if (params.email) {
          // QBO stores email in PrimaryEmailAddr.Address
          queryConditions.push(`PrimaryEmailAddr.Address = '${params.email.replace(/'/g, "\\'")}'`);
        }
        
        const query = `SELECT Id, DisplayName, PrimaryEmailAddr, SyncToken FROM Customer WHERE ${queryConditions.join(' OR ')} MAXRESULTS 10`;
        const queryUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/query?query=${encodeURIComponent(query)}&minorversion=69`;

        logger.debug(`${logPrefix} get_qbo_customer_by_display_or_email: Querying QBO: ${queryUrl}`);

        const response = await axios.get(queryUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`, // Using accessToken from params.qboCredentials
            'Accept': 'application/json',
          },
          timeout: 15000,
        });

        const qboApiCustomers = response.data?.QueryResponse?.Customer;
        if (qboApiCustomers && qboApiCustomers.length > 0) {
          logger.info(`${logPrefix} get_qbo_customer_by_display_or_email: Found ${qboApiCustomers.length} QBO Customer(s) via API.`);
          return { success: true, found: true, customers: qboApiCustomers };
        }

        logger.info(`${logPrefix} get_qbo_customer_by_display_or_email: No QBO Customer found via API for the given criteria.`);
        return { success: true, found: false, customers: [] };
        
      } catch (error: any) {
        logger.error(`${logPrefix} get_qbo_customer_by_display_or_email: Error looking up QBO Customer for tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const errorMessage = axios.isAxiosError(error) ? error.response?.data?.Fault?.Error?.[0]?.Detail || error.message : error.message;
        return { success: false, found: false, customers: [], message: `QBO API Error: ${errorMessage}`, errorDetails: error.response?.data || error };
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
        const secretProvider = getSecretProviderInstance();
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
      logger.info(`[ACTION] update_invoice_qbo_details called for invoiceId: ${params.invoiceId}, status: ${params.lastSyncStatus}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const updateData: Record<string, any> = {
          // Ensure column names match your 'invoices' table schema
          last_sync_status: params.lastSyncStatus,
          // Convert string timestamp to Date object for DB, ensure it's a valid ISO string or parse accordingly
          last_sync_timestamp: params.lastSyncTimestamp ? new Date(params.lastSyncTimestamp) : new Date(),
        };
        
        // Only include these fields in the update if they are provided (not undefined)
        if (params.qboInvoiceId !== undefined) {
          updateData.qbo_invoice_id = params.qboInvoiceId;
        }
        if (params.qboSyncToken !== undefined) {
          updateData.qbo_sync_token = params.qboSyncToken;
        }
        
        // Handle lastSyncError: store as JSON string or null
        if (params.lastSyncError !== undefined && params.lastSyncError !== null) {
          updateData.last_sync_error = JSON.stringify(params.lastSyncError);
        } else {
          // If lastSyncError is explicitly null or undefined (meaning no error or cleared error)
          updateData.last_sync_error = null;
        }
        
        const [updatedInvoice] = await knex('invoices')
          .where({ id: params.invoiceId, tenant: context.tenant })
          .update(updateData)
          .returning('*'); // Or adjust if you only need a success/failure indication
          
        if (!updatedInvoice) {
            logger.warn(`[ACTION] update_invoice_qbo_details: Invoice not found or not updated for id: ${params.invoiceId}, tenant: ${context.tenant}`);
            return { success: false, updated: false, message: `Invoice with id ${params.invoiceId} not found or no changes made.` };
        }
        
        logger.info(`[ACTION] update_invoice_qbo_details: Successfully updated QBO details for invoiceId: ${params.invoiceId}`);
        return { success: true, updated: true, updatedInvoice };
      } catch (error: any) {
        logger.error(`[ACTION] update_invoice_qbo_details: Error updating QBO details for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
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