import { Knex } from 'knex';
import logger from '@shared/core/logger.js';

/**
 * Interface for a workflow registration
 */
export interface WorkflowRegistration {
  registration_id: string;
  name: string;
  version: string;
  definition: any;
  parameters?: any;
}

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
    tenant: string,
    id: string,
    version?: string
  ): Promise<WorkflowRegistration | null> {
    try {
      // Get the workflow registration
      const registration = await knex('workflow_registrations')
        .select('registration_id', 'name', 'version')
        .where('registration_id', id)
        .where('tenant_id', tenant)
        .first();
        
      if (!registration) {
        return null;
      }
      
      // Get the specific version or current version
      let versionQuery = knex('workflow_registration_versions')
        .where('registration_id', registration.registration_id);
        
      if (version) {
        versionQuery = versionQuery.where('tenant_id', tenant);
        versionQuery = versionQuery.where('version', version);
      } else {
        versionQuery = versionQuery.where('tenant_id', tenant);
        versionQuery = versionQuery.where('is_current', true);
      }
      
      const versionRecord = await versionQuery.first();
      
      if (!versionRecord) {
        return null;
      }
      
      return {
        ...registration,
        definition: versionRecord.definition,
        parameters: versionRecord.parameters
      };
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
  ): Promise<WorkflowRegistration | null> {
    try {
      // Get the workflow registration
      const registration = await knex('workflow_registrations')
        .select('registration_id', 'name', 'version')
        .where('name', name)
        .where('tenant_id', tenant)
        .first();
        
      if (!registration) {
        return null;
      }
      
      // Get the specific version or current version
      let versionQuery = knex('workflow_registration_versions')
        .where('registration_id', registration.registration_id);
        
      if (version) {
        versionQuery = versionQuery.where('tenant_id', tenant);
        versionQuery = versionQuery.where('version', version);
      } else {
        versionQuery = versionQuery.where('tenant_id', tenant);
        versionQuery = versionQuery.where('is_current', true);
      }
      
      const versionRecord = await versionQuery.first();
      
      if (!versionRecord) {
        return null;
      }
      
      return {
        ...registration,
        definition: versionRecord.definition,
        parameters: versionRecord.parameters
      };
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
  async getAll(knex: Knex, tenant: string): Promise<WorkflowRegistration[]> {
    try {
      // Get all active workflow registrations
      const registrations = await knex('workflow_registrations')
        .where('tenant_id', tenant)
        .select('registration_id', 'name', 'version')
        .where('status', 'active');
      
      if (!registrations.length) {
        return [];
      }
      
      // Get the current version for each registration
      const results: WorkflowRegistration[] = [];
      
      for (const registration of registrations) {
        const versionRecord = await knex('workflow_registration_versions')
          .where('tenant_id', tenant)
          .where('registration_id', registration.registration_id)
          .where('is_current', true)
          .first();
        
        if (versionRecord) {
          results.push({
            ...registration,
            definition: versionRecord.definition,
            parameters: versionRecord.parameters
          });
        }
      }
      
      return results;
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
          .where('tenant_id', tenant)
          .where('template_id', templateId)
          .first();
        
        if (!template) {
          throw new Error(`Template with ID ${templateId} not found`);
        }
        
        // Create the registration
        const [registration] = await trx('workflow_registrations')
          .insert({
            tenant_id: tenant,
            name,
            description: description || template.description,
            category: template.category,
            tags: template.tags,
            version: '1.0.0',
            status: 'active',
            source_template_id: templateId,
            definition: template.definition,
            parameters: parameters || template.default_parameters || {}
          })
          .returning('registration_id');
        
        // Create the initial version
        await trx('workflow_registration_versions')
          .insert({
            tenant_id: tenant,
            registration_id: registration.registration_id,
            version: '1.0.0',
            is_current: true,
            definition: template.definition,
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