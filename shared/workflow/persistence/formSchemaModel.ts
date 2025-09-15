/**
 * Form Schema Model
 */
import { Knex } from 'knex';
import { IFormSchema } from './formRegistryInterfaces.js';
import { v4 as uuidv4 } from 'uuid';

export default class FormSchemaModel {
  private static readonly TABLE_NAME = 'workflow_form_schemas';

  /**
   * Get a form schema by ID
   */
  static async getById(
    knex: Knex,
    tenant: string,
    schemaId: string
  ): Promise<IFormSchema | null> {
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, schema_id: schemaId })
      .first();
    
    return result || null;
  }

  /**
   * Get a form schema by form ID
   */
  static async getByFormId(
    knex: Knex,
    formId: string,
    formType: 'system' | 'tenant',
    tenant?: string, // Required if formType is 'tenant'
    version?: string // Optional version, primarily for system forms
  ): Promise<IFormSchema | null> {
    if (formType === 'system') {
      // Fetch from system_workflow_form_definitions
      const systemFormRecord = await knex('system_workflow_form_definitions')
        .where({ name: formId }) // In system table, formId is the 'name'
        .modify((queryBuilder) => {
          if (version) {
            queryBuilder.andWhere({ version: version });
          } else {
            // Get latest version if version not specified by ordering
            queryBuilder.orderBy('created_at', 'desc');
          }
        })
        .first();

      if (systemFormRecord) {
        // Adapt systemFormRecord to IFormSchema structure
        return {
          schema_id: systemFormRecord.definition_id,
          form_id: systemFormRecord.name,
          tenant: 'system', // Explicitly mark as system schema context
          json_schema: systemFormRecord.json_schema,
          ui_schema: systemFormRecord.ui_schema,
          default_values: systemFormRecord.default_values,
          created_at: typeof systemFormRecord.created_at === 'string'
            ? systemFormRecord.created_at
            : systemFormRecord.created_at.toISOString(),
          updated_at: typeof systemFormRecord.updated_at === 'string'
            ? systemFormRecord.updated_at
            : systemFormRecord.updated_at.toISOString(),
        };
      }
      return null; // System form not found
    } else if (formType === 'tenant') {
      if (!tenant) {
        throw new Error("Tenant ID is required for formType 'tenant'");
      }
      // Fetch from tenant-specific workflow_form_schemas
      // Tenant-specific schemas are not versioned independently here. Version param is ignored.
      const result = await knex(this.TABLE_NAME)
        .where({ tenant, form_id: formId })
        .first();
      
      return result || null;
    } else {
      throw new Error(`Invalid formType: ${formType}`);
    }
  }

  /**
   * Create a new form schema
   */
  static async create(
    knex: Knex,
    tenant: string,
    formSchema: Omit<IFormSchema, 'tenant' | 'schema_id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    const now = new Date().toISOString();
    const schemaId = `schema-${uuidv4()}`;
    
    await knex(this.TABLE_NAME)
      .insert({
        ...formSchema,
        schema_id: schemaId,
        tenant,
        created_at: now,
        updated_at: now
      });
    
    return schemaId;
  }

  /**
   * Update a form schema
   */
  static async update(
    knex: Knex,
    tenant: string,
    formId: string,
    updates: Partial<Omit<IFormSchema, 'schema_id' | 'tenant' | 'form_id' | 'created_at' | 'updated_at'>>
  ): Promise<boolean> {
    const now = new Date().toISOString();
    
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId })
      .update({
        ...updates,
        updated_at: now
      });
    
    return result > 0;
  }

  /**
   * Delete a form schema
   */
  static async delete(
    knex: Knex,
    tenant: string,
    formId: string
  ): Promise<boolean> {
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId })
      .delete();
    
    return result > 0;
  }

  /**
   * Get all form schemas for a tenant
   */
  static async getAll(
    knex: Knex,
    tenant: string
  ): Promise<IFormSchema[]> {
    return knex(this.TABLE_NAME)
      .where({ tenant })
      .orderBy('created_at', 'desc');
  }

  /**
   * Get form schemas by form IDs
   */
  static async getByFormIds(
    knex: Knex,
    tenant: string,
    formIds: string[]
  ): Promise<IFormSchema[]> {
    if (formIds.length === 0) {
      return [];
    }
    
    return knex(this.TABLE_NAME)
      .where({ tenant })
      .whereIn('form_id', formIds);
  }

  /**
   * Check if a form schema exists
   */
  static async exists(
    knex: Knex,
    tenant: string,
    formId: string
  ): Promise<boolean> {
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId })
      .count('* as count')
      .first();
    
    return parseInt(String(result?.count || '0'), 10) > 0;
  }

  /**
   * Generate a unique schema ID
   */
  static generateSchemaId(): string {
    return `schema-${uuidv4()}`;
  }
}
