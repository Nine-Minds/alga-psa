/**
 * Form Definition Model
 */
import { Knex } from 'knex';
import { IFormDefinition, FormStatus } from './formRegistryInterfaces';
import { v4 as uuidv4 } from 'uuid';

export default class FormDefinitionModel {
  private static readonly TABLE_NAME = 'workflow_form_definitions';

  /**
   * Get a form definition by ID
   */
  static async getById(
    knex: Knex,
    tenant: string,
    formId: string
  ): Promise<IFormDefinition | null> {
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId })
      .first();
    
    return result || null;
  }

  /**
   * Get a form definition by ID and version
   */
  static async getByIdAndVersion(
    knex: Knex,
    formId: string,
    version: string,
    formType: 'system' | 'tenant',
    tenant?: string // Required if formType is 'tenant'
  ): Promise<IFormDefinition | null> {
    if (formType === 'system') {
      const systemFormRecord = await knex('system_workflow_form_definitions')
        .where({ name: formId, version })
        .first();
      if (systemFormRecord) {
        // Assuming direct compatibility for most fields, adjust as necessary
        return {
          ...systemFormRecord,
          form_id: systemFormRecord.name, // System forms use 'name' as their unique ID
          tenant: 'system',
          // Ensure date fields are consistently strings if IFormDefinition expects that
          created_at: new Date(systemFormRecord.created_at).toISOString(),
          updated_at: new Date(systemFormRecord.updated_at).toISOString(),
        } as IFormDefinition; // Cast if confident about compatibility
      }
      return null;
    } else if (formType === 'tenant') {
      if (!tenant) {
        throw new Error("Tenant ID is required for formType 'tenant' in getByIdAndVersion");
      }
      const result = await knex(this.TABLE_NAME)
        .where({ tenant, form_id: formId, version })
        .first();
      return result ? { ...result, created_at: new Date(result.created_at).toISOString(), updated_at: new Date(result.updated_at).toISOString()} as IFormDefinition : null;
    } else {
      throw new Error(`Invalid formType: ${formType}`);
    }
  }

  /**
   * Get all form definitions for a tenant
   */
  static async getAll(
    knex: Knex,
    tenant: string,
    filters: {
      status?: FormStatus;
      category?: string;
      name?: string;
    } = {}
  ): Promise<IFormDefinition[]> {
    let query = knex(this.TABLE_NAME).where({ tenant });
    
    if (filters.status) {
      query = query.where('status', filters.status);
    }
    
    if (filters.category) {
      query = query.where('category', filters.category);
    }
    
    if (filters.name) {
      query = query.where('name', 'like', `%${filters.name}%`);
    }
    
    return query.orderBy('created_at', 'desc');
  }

  /**
   * Get all versions of a form definition
   */
  static async getAllVersions(
    knex: Knex,
    tenant: string,
    formId: string
  ): Promise<IFormDefinition[]> {
    return knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId })
      .orderBy('version', 'desc');
  }

  /**
   * Get the latest version of a form definition
   */
  static async getLatestVersion(
    knex: Knex,
    formId: string,
    formType: 'system' | 'tenant',
    tenant?: string // Required if formType is 'tenant'
  ): Promise<IFormDefinition | null> {
    if (formType === 'system') {
      const systemFormRecord = await knex('system_workflow_form_definitions')
        .where({ name: formId })
        // System forms might use 'version' string or 'created_at' for latest.
        // Using created_at as a robust way if versions aren't strictly semver.
        .orderBy('created_at', 'desc')
        .first();
      if (systemFormRecord) {
        return {
          ...systemFormRecord,
          form_id: systemFormRecord.name,
          tenant: 'system',
          created_at: new Date(systemFormRecord.created_at).toISOString(),
          updated_at: new Date(systemFormRecord.updated_at).toISOString(),
        } as IFormDefinition;
      }
      return null;
    } else if (formType === 'tenant') {
      if (!tenant) {
        throw new Error("Tenant ID is required for formType 'tenant' in getLatestVersion");
      }
      const result = await knex(this.TABLE_NAME)
        .where({ tenant, form_id: formId })
         // Tenant forms use 'version' field, assuming it's sortable to find latest.
        .orderBy('version', 'desc')
        .first();
      return result ? { ...result, created_at: new Date(result.created_at).toISOString(), updated_at: new Date(result.updated_at).toISOString()} as IFormDefinition : null;
    } else {
      throw new Error(`Invalid formType: ${formType}`);
    }
  }

  /**
   * Create a new form definition
   */
  static async create(
    knex: Knex,
    tenant: string,
    formDefinition: Omit<IFormDefinition, 'tenant' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    const now = new Date().toISOString();
    
    const [result] = await knex(this.TABLE_NAME)
      .insert({
        ...formDefinition,
        tenant,
        created_at: now,
        updated_at: now
      })
      .returning('form_id');
    
    return result.form_id;
  }

  /**
   * Update a form definition
   */
  static async update(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string,
    updates: Partial<Omit<IFormDefinition, 'form_id' | 'tenant' | 'version' | 'created_at' | 'updated_at'>>
  ): Promise<boolean> {
    const now = new Date().toISOString();
    
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId, version })
      .update({
        ...updates,
        updated_at: now
      });
    
    return result > 0;
  }

  /**
   * Update form status
   */
  static async updateStatus(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string,
    status: FormStatus
  ): Promise<boolean> {
    const now = new Date().toISOString();
    
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId, version })
      .update({
        status,
        updated_at: now
      });
    
    return result > 0;
  }

  /**
   * Delete a form definition
   */
  static async delete(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string
  ): Promise<boolean> {
    const result = await knex(this.TABLE_NAME)
      .where({ tenant, form_id: formId, version })
      .delete();
    
    return result > 0;
  }

  /**
   * Search for form definitions
   */
  static async search(
    knex: Knex,
    tenant: string,
    searchParams: {
      name?: string;
      category?: string;
      status?: FormStatus;
      formId?: string;
    },
    pagination: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ total: number; forms: IFormDefinition[] }> {
    let query = knex(this.TABLE_NAME).where({ tenant });
    
    if (searchParams.formId) {
      query = query.where('form_id', searchParams.formId);
    }
    
    if (searchParams.name) {
      query = query.where('name', 'like', `%${searchParams.name}%`);
    }
    
    if (searchParams.category) {
      query = query.where('category', searchParams.category);
    }
    
    if (searchParams.status) {
      query = query.where('status', searchParams.status);
    }
    
    // Get total count
    const countResult = await query.clone().count('* as count').first();
    const total = parseInt(String(countResult?.count || '0'), 10);
    
    // Apply pagination
    if (pagination.limit) {
      query = query.limit(pagination.limit);
    }
    
    if (pagination.offset) {
      query = query.offset(pagination.offset);
    }
    
    // Get results
    const forms = await query.orderBy('created_at', 'desc');
    
    return { total, forms };
  }

  /**
   * Get form definitions by category
   */
  static async getByCategory(
    knex: Knex,
    tenant: string,
    category: string
  ): Promise<IFormDefinition[]> {
    return knex(this.TABLE_NAME)
      .where({ tenant, category })
      .orderBy('created_at', 'desc');
  }

  /**
   * Get all unique categories
   */
  static async getAllCategories(
    knex: Knex,
    tenant: string
  ): Promise<string[]> {
    const results = await knex(this.TABLE_NAME)
      .where({ tenant })
      .whereNotNull('category')
      .distinct('category');
    
    return results.map(r => r.category);
  }

  /**
   * Generate a unique form ID
   */
  static generateFormId(): string {
    return `form-${uuidv4()}`;
  }
}
