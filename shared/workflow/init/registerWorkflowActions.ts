/**
 * Shared module for registering workflow actions
 * This file contains all the action registration logic and can be called
 * from both the server and the workflow-worker
 */

import { getActionRegistry, type ActionRegistry, type ActionExecutionContext } from '@alga-psa/shared/workflow/core/index';
import { logger } from '@alga-psa/shared/core';
import { getTaskInboxService } from '@alga-psa/shared/workflow/core/taskInboxService';
import axios from 'axios'; // For QBO API calls
import { getSecretProviderInstance } from '@alga-psa/shared/core';

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

// --- QBO Customer Specific Types ---
interface QuickBooksCompanyInfo {
  Id: string;
  SyncToken: string;
  DisplayName?: string;
  PrimaryNameValue?: string; // For individual customers
  GivenName?: string;
  MiddleName?: string;
  FamilyName?: string;
  Suffix?: string;
  FullyQualifiedName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  BillAddr?: {
    Id?: string;
    Line1?: string;
    Line2?: string;
    Line3?: string;
    Line4?: string;
    Line5?: string;
    City?: string;
    Country?: string;
    CountrySubDivisionCode?: string; // State
    PostalCode?: string;
    Lat?: string;
    Long?: string;
  };
  // Add other fields as necessary based on typical QBO Customer structure
}

interface QboCustomerByIdResult {
  success: boolean;
  customer?: QuickBooksCompanyInfo;
  message?: string;
  errorDetails?: any;
  qboRawResponse?: any;
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
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const items = await knex('invoice_items')
          .select('invoice_items.*', 'service_catalog.service_name')
          .leftJoin('service_catalog', 'invoice_items.service_id', 'service_catalog.service_id')
          .where({ 'invoice_items.invoice_id': params.invoiceId, 'invoice_items.tenant': context.tenant });

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
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const company = await knex('companies')
          .select('*') // This will fetch address and billing_email if they exist
          .where({ company_id: params.id, tenant: context.tenant })
          .first();

        if (!company) {
          logger.warn(`[ACTION] get_company: Company not found for id: ${params.id}, tenant: ${context.tenant}`);
          const err = new Error(`Company with id ${params.id} not found for tenant ${context.tenant}.`);
          (err as any).status = 404;
          throw err;
        }

        logger.info(`[ACTION] get_company: Successfully fetched company id: ${params.id}`);
        logger.info(`[ACTION] get_company: Company details from DB: ${JSON.stringify(company)}`);

        return company;
      } catch (error: any) {
        logger.error(`[ACTION] get_company: Error fetching company id: ${params.id}, tenant: ${context.tenant}`, error);
        throw error; // Re-throw error
      }
    }
  );

  // Get company default location
  actionRegistry.registerSimpleAction(
    'get_company_default_location',
    'Get the default location for a company',
    [
      { name: 'companyId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] get_company_default_location called for companyId: ${params.companyId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const location = await knex('company_locations')
          .select('*')
          .where({
            company_id: params.companyId,
            tenant: context.tenant,
            is_default: true,
            is_active: true
          })
          .first();

        if (!location) {
          logger.warn(`[ACTION] get_company_default_location: No default location found for company: ${params.companyId}, tenant: ${context.tenant}`);
          return {
            success: true,
            found: false,
            location: null,
            message: `No default location found for company ${params.companyId}`
          };
        }

        logger.info(`[ACTION] get_company_default_location: Successfully fetched default location for company: ${params.companyId}`);

        return {
          success: true,
          found: true,
          location: location
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_company_default_location: Error fetching default location for company: ${params.companyId}, tenant: ${context.tenant}`, error);
        return {
          success: false,
          found: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Get all company locations
  actionRegistry.registerSimpleAction(
    'get_company_locations',
    'Get all active locations for a company',
    [
      { name: 'companyId', type: 'string', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      logger.info(`[ACTION] get_company_locations called for companyId: ${params.companyId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const locations = await knex('company_locations')
          .select('*')
          .where({
            company_id: params.companyId,
            tenant: context.tenant,
            is_active: true
          })
          .orderBy('is_default', 'desc')
          .orderBy('location_name', 'asc');

        logger.info(`[ACTION] get_company_locations: Successfully fetched ${locations.length} locations for company: ${params.companyId}`);

        return {
          success: true,
          locations: locations,
          count: locations.length
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_company_locations: Error fetching locations for company: ${params.companyId}, tenant: ${context.tenant}`, error);
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
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const mapping = await knex('tenant_external_entity_mappings')
          .select('external_entity_id')
          .where({
            tenant: context.tenant,
            alga_entity_id: params.algaProductId,
            alga_entity_type: 'service', // Assuming this mapping type
            integration_type: 'quickbooks_online',
            external_realm_id: params.realmId
          })
          .first();

        if (mapping) { // Check if mapping is not null/undefined
          logger.info(`[ACTION] lookup_qbo_item_id: Found QBO item ID: ${mapping.external_entity_id} for Alga product ID: ${params.algaProductId} via DB mapping.`);
          return { success: true, found: true, qboItemId: mapping.external_entity_id };
        } else {
          logger.info(`[ACTION] lookup_qbo_item_id: Alga product ID ${params.algaProductId} not found in DB mapping.`);
          return { success: true, found: false, qboItemId: null };
        }

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

  // Get QBO Customer by ID
  actionRegistry.registerSimpleAction(
    'get_qbo_customer_by_id',
    'Get a QBO Customer by its ID.',
    [
      { name: 'qboCustomerId', type: 'string', required: true, description: 'The ID of the QBO customer to fetch.' },
      { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID.' },
      { name: 'qboCredentials', type: 'object', required: true, description: 'QBO credentials object including accessToken, realmId, and accessTokenExpiresAt.' },
      // tenantId will be implicitly available via ActionExecutionContext
    ],
    async (params: Record<string, any>, context: ActionExecutionContext): Promise<QboCustomerByIdResult> => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})] get_qbo_customer_by_id:`;
      logger.info(`${logPrefix} Called for QBO Customer ID: ${params.qboCustomerId}, Realm ID: ${params.realmId}, Tenant: ${context.tenant}`);

      try {
        const qboCredentials = params.qboCredentials as QboCredentials;

        if (!qboCredentials) {
          logger.error(`${logPrefix} QBO credentials not provided. RealmId: ${params.realmId}, CustomerId: ${params.qboCustomerId}`);
          return { success: false, message: 'QBO credentials not provided.' };
        }

        const { accessToken, accessTokenExpiresAt } = qboCredentials;

        if (!accessToken || !accessTokenExpiresAt) {
          logger.error(`${logPrefix} Missing QBO accessToken or accessTokenExpiresAt in provided credentials. RealmId: ${params.realmId}, CustomerId: ${params.qboCustomerId}`);
          return { success: false, message: 'QBO API call requires valid credentials (accessToken or accessTokenExpiresAt missing).' };
        }

        if (new Date(accessTokenExpiresAt) < new Date()) {
          logger.warn(`${logPrefix} QBO access token expired (using provided credentials). RealmId: ${params.realmId}, CustomerId: ${params.qboCustomerId}`);
          return { success: false, message: 'QBO access token expired. Please reconnect QuickBooks integration.' };
        }

        const apiUrl = `${QBO_BASE_URL}/v3/company/${params.realmId}/customer/${params.qboCustomerId}?minorversion=69`;
        logger.debug(`${logPrefix} Querying QBO: ${apiUrl}`);

        const response = await axios.get(apiUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
          timeout: 15000, // Standard timeout for GET requests
        });

        const qboCustomer = response.data?.Customer;

        if (qboCustomer && qboCustomer.Id) {
          logger.info(`${logPrefix} Successfully fetched QBO Customer ${qboCustomer.Id}. RealmId: ${params.realmId}`);
          return {
            success: true,
            customer: qboCustomer as QuickBooksCompanyInfo,
            qboRawResponse: response.data,
          };
        } else {
          // This case handles if QBO API returns 200 OK but no Customer object, or Customer object is malformed.
          logger.warn(`${logPrefix} QBO API call successful but customer data is missing or malformed. RealmId: ${params.realmId}, CustomerId: ${params.qboCustomerId}. Response: ${JSON.stringify(response.data)}`);
          return {
            success: false,
            message: 'QBO API call successful, but customer data is missing or malformed in the response.',
            qboRawResponse: response.data,
            errorDetails: response.data, // Provide the raw response as error details
          };
        }
      } catch (error: any) {
        logger.error(`${logPrefix} Error fetching QBO Customer by ID ${params.qboCustomerId}, RealmId: ${params.realmId}, Tenant: ${context.tenant}`, error.response?.data || error.message || error);
        const faultError = error.response?.data?.Fault?.Error?.[0];
        let errorMessage = 'An unexpected error occurred while fetching QBO customer.';
        if (faultError) {
          errorMessage = `QBO API Error: ${faultError.Message || 'Unknown QBO Error'}. Detail: ${faultError.Detail || 'No additional details.'} Code: ${faultError.code || 'N/A'}`;
        } else if (axios.isAxiosError(error) && error.message) {
            errorMessage = `Network/Request Error: ${error.message}`;
        } else if (error.message) {
            errorMessage = error.message;
        }

        // Specifically check for "Object Not Found" type errors from QBO.
        // QBO error code for "Object Not Found" is often 6240 in the detail.
        // Also check if the status code is 404, which QBO might return for a non-existent resource.
        if (error.response?.status === 404 || faultError?.Detail?.includes("Object Not Found") || faultError?.code === "6240" || (error.response?.status === 400 && faultError?.Message?.toLowerCase().includes("not found"))) {
            logger.info(`${logPrefix} QBO Customer ID ${params.qboCustomerId} not found in Realm ID ${params.realmId}. Status: ${error.response?.status}`);
            return {
                success: false,
                message: `QBO Customer with ID ${params.qboCustomerId} not found. Detail: ${faultError?.Detail || 'Not found.'}`,
                errorDetails: error.response?.data || error.toString(),
                qboRawResponse: error.response?.data
            };
        }

        return {
            success: false,
            message: errorMessage,
            errorDetails: error.response?.data || error.toString(),
            qboRawResponse: error.response?.data
        };
      }
    }
  );

  // Update Alga company QBO mapping details
  actionRegistry.registerSimpleAction(
    'update_company_qbo_details',
    'Update Alga company QBO mapping in tenant_external_entity_mappings with QBO customer ID and sync token.',
    [
      { name: 'companyId', type: 'string', required: true, description: 'The ID of the Alga company to update.' },
      { name: 'qboCustomerId', type: 'string', required: true, description: 'The QBO customer ID.' },
      { name: 'qboSyncToken', type: 'string', required: true, description: 'The QBO sync token for the customer.' },
      { name: 'realmId', type: 'string', required: true, description: 'The QBO Realm ID.' },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      logger.info(`${logPrefix} update_company_qbo_details called for companyId: ${params.companyId}, qboCustomerId: ${params.qboCustomerId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);

      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const mappingData = {
          tenant: context.tenant,
          integration_type: 'quickbooks_online',
          alga_entity_type: 'company', // Assuming 'company' is the Alga entity type mapping to QBO Customer
          alga_entity_id: params.companyId,
          external_entity_id: params.qboCustomerId,
          external_realm_id: params.realmId,
          sync_status: 'SYNCED', // Or a more appropriate status
          metadata: { qboSyncToken: params.qboSyncToken }, // Store sync token in metadata
          updated_at: new Date(),
        };

        // Perform an upsert operation
        // The conflict target should be the unique key identifying a mapping
        // Adjust conflict target columns as per your actual table schema's unique constraints for a mapping
        const conflictTarget = ['tenant', 'integration_type', 'alga_entity_type', 'alga_entity_id'];

        const [updatedMapping] = await knex('tenant_external_entity_mappings')
          .insert(mappingData)
          .onConflict(conflictTarget)
          .merge({
            external_entity_id: params.qboCustomerId, // Ensure external_entity_id is updated on conflict
            sync_status: 'SYNCED',
            metadata: { qboSyncToken: params.qboSyncToken },
            updated_at: new Date(),
          })
          .returning('*');

        if (!updatedMapping) {
          logger.warn(`${logPrefix} update_company_qbo_details: Mapping not created or updated for companyId: ${params.companyId}, qboCustomerId: ${params.qboCustomerId}, realmId: ${params.realmId}, tenant: ${context.tenant}`);
          // This case might be unlikely with upsert unless there's a fundamental DB issue not caught by try/catch
          return { success: false, updated: false, message: 'Mapping not created or updated.' };
        }

        logger.info(`${logPrefix} update_company_qbo_details: Successfully created/updated mapping for company ${params.companyId} with QBO customer ${params.qboCustomerId}.`);
        return { success: true, updated: true, updatedMapping };

      } catch (error: any) {
        logger.error(`${logPrefix} update_company_qbo_details: Error creating/updating mapping for company ${params.companyId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
    }
  );

  // Retrieves an external entity mapping for an Alga entity, system, and realm.
  actionRegistry.registerSimpleAction(
    'get_external_entity_mapping',
    'Retrieves an external entity mapping for an Alga entity, system, and realm.',
    [
      { name: 'algaEntityId', type: 'string', required: true, description: 'The ID of the Alga entity (e.g., company ID, invoice ID).' },
      { name: 'externalSystemName', type: 'string', required: true, description: 'The name of the external system (e.g., \'quickbooks_online\').' },
      { name: 'externalRealmId', type: 'string', required: true, description: 'The realm ID for the external system (e.g., QBO realmId).' },
      { name: 'algaEntityType', type: 'string', required: false, description: 'The type of Alga entity (e.g., "invoice", "company"). Defaults to "company" if not specified.' }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const logPrefix = `[ACTION] [${context.workflowName || 'UnknownWorkflow'}${context.correlationId ? `:${context.correlationId}` : ''} (${context.executionId})]`;
      const entityType = params.algaEntityType || 'company'; // Default to 'company' for backward compatibility

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
      { name: 'algaEntityType', type: 'string', required: true, description: 'The type of Alga entity (e.g., "invoice", "company").' },
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

  // Placeholder for update_invoice_qbo_details
  actionRegistry.registerSimpleAction(
    'update_invoice_qbo_details',
    'Update Alga invoice QBO details (placeholder)',
    [
      { name: 'invoiceId', type: 'string', required: true },
      { name: 'qboInvoiceId', type: 'string', required: false },
      { name: 'qboSyncToken', type: 'string', required: false },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      // Removed status from log as it's no longer a direct parameter for this action's core responsibility
      logger.info(`[ACTION] update_invoice_qbo_details called for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`);
      try {
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        const updateData: Record<string, any> = {};
        let hasUpdates = false;

        // Only include QBO fields in the update if they are provided
        if (params.qboInvoiceId !== undefined) {
          updateData.qbo_invoice_id = params.qboInvoiceId;
          hasUpdates = true;
        }
        if (params.qboSyncToken !== undefined) {
          updateData.qbo_sync_token = params.qboSyncToken;
          hasUpdates = true;
        }

        // If neither qboInvoiceId nor qboSyncToken is provided, there's nothing to update on the invoice itself.
        if (!hasUpdates) {
            logger.info(`[ACTION] update_invoice_qbo_details: No QBO ID or SyncToken provided for invoiceId: ${params.invoiceId}. No update performed on 'invoices' table.`);
            // Returning success: true because the action didn't fail, it just had nothing to do based on input.
            // The workflow might still need to update the mapping table status separately.
            return { success: true, updated: false, message: "No QBO ID or SyncToken provided; no update needed on invoice record." };
        }

        const [updatedInvoice] = await knex('invoices')
          .where({ invoice_id: params.invoiceId, tenant: context.tenant }) // Assumes invoice_id is the correct column name
          .update(updateData)
          .returning('*'); // Or adjust if you only need a success/failure indication

        if (!updatedInvoice) {
            logger.warn(`[ACTION] update_invoice_qbo_details: Invoice not found or not updated for id: ${params.invoiceId}, tenant: ${context.tenant} with data: ${JSON.stringify(updateData)}`);
            // Throw an error here, as if we had data to update but didn't find the record, it's an issue.
            throw new Error(`Invoice with id ${params.invoiceId} not found for tenant ${context.tenant}.`);
        }

        logger.info(`[ACTION] update_invoice_qbo_details: Successfully updated QBO ID/Token for invoiceId: ${params.invoiceId}`);
        return { success: true, updated: true, updatedInvoice };
      } catch (error: any) {
        logger.error(`[ACTION] update_invoice_qbo_details: Error updating QBO details for invoiceId: ${params.invoiceId}, tenant: ${context.tenant}`, error);
        return { success: false, message: error.message, error };
      }
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
    'Create or find contact by email and company',
    [
      { name: 'email', type: 'string', required: true },
      { name: 'name', type: 'string', required: false },
      { name: 'company_id', type: 'string', required: true },
      { name: 'phone', type: 'string', required: false },
      { name: 'title', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createOrFindContact } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createOrFindContact({
          email: params.email,
          name: params.name,
          company_id: params.company_id,
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
      { name: 'company_id', type: 'string', required: false },
      { name: 'contact_id', type: 'string', required: false },
      { name: 'source', type: 'string', required: false },
      { name: 'channel_id', type: 'string', required: false },
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
          company_id: params.company_id,
          contact_id: params.contact_id,
          source: params.source,
          channel_id: params.channel_id,
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
      { name: 'author_id', type: 'string', required: false }
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
          author_id: params.author_id
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

  // Email Company Actions
  actionRegistry.registerSimpleAction(
    'create_company_from_email',
    'Create a company from email data',
    [
      { name: 'company_name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
      { name: 'source', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createCompanyFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createCompanyFromEmail({
          company_name: params.company_name,
          email: params.email,
          source: params.source
        }, context.tenant);

        return {
          success: true,
          company: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_company_from_email: Error creating company ${params.company_name}`, error);
        return {
          success: false,
          company: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'get_company_by_id_for_email',
    'Get company by ID for email workflows',
    [{ name: 'companyId', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { getCompanyByIdForEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const company = await getCompanyByIdForEmail(params.companyId, context.tenant);

        return {
          success: !!company,
          company: company
        };
      } catch (error: any) {
        logger.error(`[ACTION] get_company_by_id_for_email: Error getting company ${params.companyId}`, error);
        return {
          success: false,
          company: null,
          message: error.message
        };
      }
    }
  );

  // Email Channel Actions
  actionRegistry.registerSimpleAction(
    'find_channel_by_name',
    'Find a channel by name',
    [{ name: 'name', type: 'string', required: true }],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        // Import the database connection
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = await getAdminConnection();

        let channel = await knex('channels')
          .select('channel_id as id', 'channel_name as name', 'description', 'is_default')
          .where({ tenant: context.tenant, channel_name: params.name })
          .andWhere('is_inactive', false)
          .first();
        if (!channel) {
          // Fallback: default active channel, else first active by display_order
          channel = await knex('channels')
            .select('channel_id as id', 'channel_name as name', 'description', 'is_default')
            .where({ tenant: context.tenant })
            .andWhere('is_inactive', false)
            .andWhere('is_default', true)
            .first();
          if (!channel) {
            channel = await knex('channels')
              .select('channel_id as id', 'channel_name as name', 'description', 'is_default')
              .where({ tenant: context.tenant })
              .andWhere('is_inactive', false)
              .orderBy('display_order', 'asc')
              .first();
          }
          if (!channel) {
            logger.warn(`[ACTION] find_channel_by_name: No active channel found for tenant=${context.tenant}, name='${params.name}'`);
          }
        }

        return {
          success: !!channel,
          channel: channel
        };
      } catch (error: any) {
        logger.error(`[ACTION] find_channel_by_name: Error finding channel ${params.name}`, error);
        return {
          success: false,
          channel: null,
          message: error.message
        };
      }
    }
  );

  actionRegistry.registerSimpleAction(
    'create_channel_from_email',
    'Create a channel from email data',
    [
      { name: 'channel_name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'is_default', type: 'boolean', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { createChannelFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await createChannelFromEmail({
          channel_name: params.channel_name,
          description: params.description,
          is_default: params.is_default
        }, context.tenant);

        return {
          success: true,
          channel: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_channel_from_email: Error creating channel ${params.channel_name}`, error);
        return {
          success: false,
          channel: null,
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
      { name: 'company_id', type: 'string', required: true },
      { name: 'contact_id', type: 'string', required: false },
      { name: 'confidence_score', type: 'number', required: false },
      { name: 'notes', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        const { saveEmailClientAssociation } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
        const result = await saveEmailClientAssociation({
          email: params.email,
          company_id: params.company_id,
          contact_id: params.contact_id,
          confidence_score: params.confidence_score,
          notes: params.notes
        }, context.tenant);

        return {
          success: result.success,
          associationId: result.associationId,
          email: result.email,
          company_id: result.company_id
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
