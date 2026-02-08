import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';

/**
 * Interface for a workflow registration
 */
export interface WorkflowRegistration {
  registration_id: string;
  name: string;
  version: string;
  code?: any; // From the version table (previously definition)
  parameters?: any; // From the version table
  // Add other fields from registration table if needed by UI
  description?: string;
  category?: string;
  tags?: string[];
  status?: string;
  source_template_id?: string;
  created_by?: string;
  created_at?: string; // Consider adding timestamps if needed
  updated_at?: string;
}

// Add the flag to the return type
export type WorkflowRegistrationWithSystemFlag = WorkflowRegistration & { isSystemManaged: boolean };

/**
 * Model for workflow registrations
 * This handles database operations for workflow registrations
 */
export default {
  /**
   * Get a workflow registration by ID and optional version
   * If version is not provided, returns the current version
   *
   * @param knex The Knex instance
   * @param tenant The tenant ID
   * @param id The workflow registration ID
   * @param version Optional version string
   * @returns The workflow registration or null if not found
   */
  async getById(
    knex: Knex,
    tenant: string, // Keep tenant for RLS/context, but system query ignores it
    id: string,
    version?: string // Version applies to both tenant and system lookups
  ): Promise<WorkflowRegistrationWithSystemFlag | null> { // Updated return type
    try {
      // --- Try Tenant Workflow ---
      const tenantRegistration = await knex('workflow_registrations as wr')
        .select(
          'wr.registration_id', 'wr.name', 'wr.description', 'wr.category',
          'wr.tags', 'wr.status', 'wr.source_template_id', 'wr.created_by',
          'wr.created_at', 'wr.updated_at', // Select specific columns from wr
          'wrv.code', // Select code from wrv
          'wrv.parameters', // Select parameters from wrv
          'wrv.version as current_version',
          knex.raw('false as "isSystemManaged"')
        )
        .join('workflow_registration_versions as wrv', function() {
          this.on('wr.registration_id', '=', 'wrv.registration_id')
              .andOn('wr.tenant', '=', 'wrv.tenant'); // Join includes tenant
          if (version) {
            this.andOn('wrv.version', '=', knex.raw('?', [version]));
          } else {
            this.andOn('wrv.is_current', '=', knex.raw('?', [true]));
          }
        })
        .where('wr.registration_id', id)
        .where('wr.tenant', tenant) // Filter registration by tenant
        .first();

      if (tenantRegistration) {
        // Map fields to expected WorkflowRegistration structure if needed
        return {
          registration_id: tenantRegistration.registration_id,
          name: tenantRegistration.name,
          version: tenantRegistration.current_version,
          code: tenantRegistration.code, // Use .code from the select
          parameters: tenantRegistration.parameters, // Use .parameters from the select (from wrv)
          description: tenantRegistration.description,
          category: tenantRegistration.category,
          tags: tenantRegistration.tags,
          status: tenantRegistration.status,
          source_template_id: tenantRegistration.source_template_id,
          created_by: tenantRegistration.created_by,
          created_at: tenantRegistration.created_at,
          updated_at: tenantRegistration.updated_at,
          isSystemManaged: false,
        };
      }

      // --- Try System Workflow ---
      const systemRegistration = await knex('system_workflow_registrations as swr')
        .select(
          'swr.registration_id', 'swr.name', 'swr.description', 'swr.category',
          'swr.tags', 'swr.status', 'swr.source_template_id', 'swr.created_by',
          'swr.created_at', 'swr.updated_at',
          'swrv.code', // Select code from version table
          'swrv.parameters', // Select parameters from version table
          'swrv.version as current_version',
          knex.raw('true as "isSystemManaged"')
        )
        .join('system_workflow_registration_versions as swrv', function() {
          this.on('swr.registration_id', '=', 'swrv.registration_id'); // No tenant join
          if (version) {
            this.andOn('swrv.version', '=', knex.raw('?', [version]));
          } else {
            this.andOn('swrv.is_current', '=', knex.raw('?', [true]));
          }
        })
        .where('swr.registration_id', id) // No tenant filter for system registration
        .first();

      if (systemRegistration) {
        return {
          registration_id: systemRegistration.registration_id,
          name: systemRegistration.name,
          version: systemRegistration.current_version,
          code: systemRegistration.code, // Map to code
          parameters: systemRegistration.parameters, // From swrv.parameters
          description: systemRegistration.description,
          category: systemRegistration.category,
          tags: systemRegistration.tags,
          status: systemRegistration.status,
          source_template_id: systemRegistration.source_template_id,
          created_by: systemRegistration.created_by,
          created_at: systemRegistration.created_at,
          updated_at: systemRegistration.updated_at,
          isSystemManaged: true,
        };
      }

      return null; // Not found in either table
    } catch (error) {
      logger.error(`Error getting workflow registration for ID ${id}:`, error);
      throw error;
    }
  },
  /**
   * Get a workflow registration by name and optional version
   * If version is not provided, returns the current version
   * 
   * @param knex The Knex instance
   * @param tenant The tenant ID
   * @param name The workflow name
   * @param version Optional version string
   * @returns The workflow registration or null if not found
   */
  async getByName(
    knex: Knex,
    tenant: string,
    name: string,
    version?: string
  ): Promise<WorkflowRegistrationWithSystemFlag | null> { // Updated return type
    try {
      // --- Try Tenant Workflow ---
      const tenantRegistration = await knex('workflow_registrations as wr')
        .select(
          'wr.registration_id', 'wr.name', 'wr.description', 'wr.category',
          'wr.tags', 'wr.status', 'wr.source_template_id', 'wr.created_by',
          'wr.created_at', 'wr.updated_at', // Select specific columns from wr
          'wrv.code', // Select code from wrv
          'wrv.parameters', // Select parameters from wrv
          'wrv.version as current_version',
          knex.raw('false as "isSystemManaged"')
        )
        .join('workflow_registration_versions as wrv', function() {
          this.on('wr.registration_id', '=', 'wrv.registration_id')
              .andOn('wr.tenant', '=', 'wrv.tenant');
          if (version) {
            this.andOn('wrv.version', '=', knex.raw('?', [version]));
          } else {
            this.andOn('wrv.is_current', '=', knex.raw('?', [true]));
          }
        })
        .where('wr.name', name)
        .where('wr.tenant', tenant)
        .first();

      if (tenantRegistration) {
        return {
          registration_id: tenantRegistration.registration_id,
          name: tenantRegistration.name,
          version: tenantRegistration.current_version,
          code: tenantRegistration.code, // Use .code from the select
          parameters: tenantRegistration.parameters, // Use .parameters from the select (from wrv)
          description: tenantRegistration.description,
          category: tenantRegistration.category,
          tags: tenantRegistration.tags,
          status: tenantRegistration.status,
          source_template_id: tenantRegistration.source_template_id,
          created_by: tenantRegistration.created_by,
          created_at: tenantRegistration.created_at,
          updated_at: tenantRegistration.updated_at,
          isSystemManaged: false,
        };
      }

      // --- Try System Workflow ---
      const systemRegistration = await knex('system_workflow_registrations as swr')
        .select(
          'swr.registration_id', 'swr.name', 'swr.description', 'swr.category',
          'swr.tags', 'swr.status', 'swr.source_template_id', 'swr.created_by',
          'swr.created_at', 'swr.updated_at',
          'swrv.code', // Select code from version table
          'swrv.parameters', // Select parameters from version table
          'swrv.version as current_version',
          knex.raw('true as "isSystemManaged"')
        )
        .join('system_workflow_registration_versions as swrv', function() {
          this.on('swr.registration_id', '=', 'swrv.registration_id');
          if (version) {
            this.andOn('swrv.version', '=', knex.raw('?', [version]));
          } else {
            this.andOn('swrv.is_current', '=', knex.raw('?', [true]));
          }
        })
        .where('swr.name', name) // No tenant filter
        .first();

      if (systemRegistration) {
         return {
          registration_id: systemRegistration.registration_id,
          name: systemRegistration.name,
          version: systemRegistration.current_version,
          code: systemRegistration.code, // Map to code
          parameters: systemRegistration.parameters, // From swrv.parameters
          description: systemRegistration.description,
          category: systemRegistration.category,
          tags: systemRegistration.tags,
          status: systemRegistration.status,
          source_template_id: systemRegistration.source_template_id,
          created_by: systemRegistration.created_by,
          created_at: systemRegistration.created_at,
          updated_at: systemRegistration.updated_at,
          isSystemManaged: true,
        };
      }

      return null; // Not found
    } catch (error) {
      logger.error(`Error getting workflow registration for ${name}:`, error);
      throw error;
    }
  },
  
  /**
   * Get all workflow registrations
   * 
   * @param knex The Knex instance
   * @param tenant The tenant ID
   * @returns Array of workflow registrations
   */
  async getAll(knex: Knex, tenant: string): Promise<WorkflowRegistrationWithSystemFlag[]> { // Updated return type
    try {
      // --- Tenant Workflows ---
      const tenantRegistrations = knex('workflow_registrations as wr')
        .select(
          'wr.registration_id',
          'wr.name',
          'wr.description',
          'wr.category',
          'wr.tags',
          'wr.status',
          'wr.source_template_id',
          'wr.created_by',
          'wr.created_at',
          'wr.updated_at',
          'wrv.version as current_version',
          'wrv.code', // Select code directly
          'wrv.parameters',
          knex.raw('false as "isSystemManaged"')
        )
        .join('workflow_registration_versions as wrv', function() {
          this.on('wr.registration_id', '=', 'wrv.registration_id')
              .andOn('wr.tenant', '=', 'wrv.tenant')
              .andOn('wrv.is_current', '=', knex.raw('?', [true])); // Join only on current version
        })
        .where('wr.tenant', tenant)
        .where('wr.status', 'active'); // Assuming 'active' status means visible

      // --- System Workflows ---
      const systemRegistrations = knex('system_workflow_registrations as swr')
        .select(
          'swr.registration_id',
          'swr.name',
          'swr.description',
          'swr.category',
          'swr.tags',
          'swr.status',
          'swr.source_template_id',
          'swr.created_by',
          'swr.created_at',
          'swr.updated_at',
          'swrv.version as current_version',
          'swrv.code', // Select code from version table for system workflows
          'swrv.parameters', // Select parameters from version table
          knex.raw('true as "isSystemManaged"')
        )
        .join('system_workflow_registration_versions as swrv', function() {
          this.on('swr.registration_id', '=', 'swrv.registration_id')
              .andOn('swrv.is_current', '=', knex.raw('?', [true])); // Join only on current version
        })
        .where('swr.status', 'active'); // Assuming 'active' status means visible

      // --- Combine Results ---
      const combinedResults = await knex.unionAll([tenantRegistrations, systemRegistrations], true);

      // Map to expected structure
      return combinedResults.map(reg => ({
        registration_id: reg.registration_id,
        name: reg.name,
        version: reg.current_version,
        code: reg.code, // Map to code
        parameters: reg.parameters, // From version table's parameters
        description: reg.description,
        category: reg.category,
        tags: reg.tags,
        status: reg.status,
        source_template_id: reg.source_template_id,
        created_by: reg.created_by,
        created_at: reg.created_at,
        updated_at: reg.updated_at,
        isSystemManaged: reg.isSystemManaged,
      }));

    } catch (error) {
      logger.error('Error getting all workflow registrations:', error);
      throw error;
    }
  },
  
  /**
   * Create a workflow registration from a template
   * 
   * @param knex The Knex instance
   * @param tenant The tenant ID
   * @param params Parameters for creating a registration from a template
   * @returns The created workflow registration ID
   */
  async createFromTemplate(
    knex: Knex, 
    tenant: string, 
    params: {
      templateId: string;
      name: string;
      description?: string;
      parameters?: any;
    }
  ): Promise<{ registrationId: string }> {
    const { templateId, name, description, parameters } = params;
    
    try {
      return await knex.transaction(async (trx: Knex.Transaction) => {
        // Get the template
        const template = await trx('workflow_templates')
          .where('tenant', tenant)
          .where('template_id', templateId)
          .first();
        
        if (!template) {
          throw new Error(`Template with ID ${templateId} not found`);
        }
        
        // Create the registration
        const [registration] = await trx('workflow_registrations')
          .insert({
            tenant: tenant,
            name,
            description: description || template.description,
            category: template.category,
            tags: template.tags,
            version: '1.0.0',
            status: 'active',
            source_template_id: templateId,
            parameters: parameters || template.default_parameters || {}
          })
          .returning('registration_id');
        
        // Create the initial version
        await trx('workflow_registration_versions')
          .insert({
            tenant: tenant,
            registration_id: registration.registration_id,
            version: '1.0.0',
            is_current: true,
            code: template.definition, // Assuming template.definition is the code/script
            parameters: parameters || template.default_parameters || {}
          });
        
        return { registrationId: registration.registration_id };
      });
    } catch (error) {
      logger.error(`Error creating workflow registration from template ${templateId}:`, error);
      throw error;
    }
  }
};
