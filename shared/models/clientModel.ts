/**
 * Shared Client Model - Core business logic for client operations
 * This model contains the essential client business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { 
  IClient, 
  CreateClientInput, 
  UpdateClientInput, 
  ClientCreationOptions 
} from '../interfaces/client.interfaces';
import { ValidationResult } from '../interfaces/validation.interfaces';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core client form validation schema extracted from server actions
export const clientFormSchema = z.object({
  client_name: z.string().min(1, 'Client name is required'),
  client_type: z.enum(['company', 'individual']).optional(),
  url: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  phone_no: z.string().optional(),
  email: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
  address: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  properties: z.record(z.any()).optional(),
  parent_client_id: z.string().uuid().optional().nullable(),
  contract_line_id: z.string().uuid().optional().nullable()
});

// Complete client schema for validation
export const clientSchema = z.object({
  client_id: z.string().uuid(),
  client_name: z.string(),
  client_type: z.enum(['company', 'individual']).nullable(),
  tenant: z.string().uuid(),
  url: z.string().nullable(),
  phone_no: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  address_2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
  is_inactive: z.boolean().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  properties: z.record(z.any()).nullable(),
  parent_client_id: z.string().uuid().nullable(),
  contract_line_id: z.string().uuid().nullable(),
  is_default: z.boolean().nullable()
});

// Client update schema
export const clientUpdateSchema = clientSchema.partial().omit({
  client_id: true,
  tenant: true,
  created_at: true
});

// =============================================================================
// Re-export interfaces for backward compatibility
// =============================================================================

export type { 
  IClient, 
  CreateClientInput, 
  UpdateClientInput, 
  ClientCreationOptions 
} from '../interfaces/client.interfaces';
export type { ValidationResult } from '../interfaces/validation.interfaces';

// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================

/**
 * Validates form data using the provided schema
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Validation failed: ${errorMessages}`);
    }
    throw error;
  }
}

/**
 * Cleans empty string values to null for nullable fields
 */
export function cleanNullableFields(data: Record<string, any>): Record<string, any> {
  const cleaned = { ...data };
  const nullableFields = [
    'url', 'phone_no', 'email', 'address', 'address_2', 
    'city', 'state', 'zip', 'country', 'notes', 
    'parent_client_id', 'contract_line_id'
  ];
  
  for (const field of nullableFields) {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  }
  
  return cleaned;
}

// =============================================================================
// CORE CLIENT MODEL
// =============================================================================

export class ClientModel {
  /**
   * Validates client creation input
   */
  static validateCreateClientInput(input: CreateClientInput): ValidationResult {
    try {
      // Basic required field validation
      if (!input.client_name || input.client_name.trim() === '') {
        return { valid: false, errors: ['Client name is required'] };
      }

      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(clientFormSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Validates client update input
   */
  static validateUpdateClientInput(input: UpdateClientInput): ValidationResult {
    try {
      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(clientUpdateSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  // Email domain extraction removed for security

  /**
   * Create default tax settings for a client
   * Delegates to TaxService for consistency with existing implementation
   */
  static async createDefaultTaxSettings(
    clientId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Get the first active tax rate to use as the default
    const defaultTaxRate = await trx('tax_rates')
      .where('tenant', tenant)
      .andWhere('is_active', true)
      .orderBy('created_at', 'asc')
      .first();

    if (!defaultTaxRate) {
      // Create a default tax rate if none exists
      const taxRateId = uuidv4();
      const now = new Date().toISOString();
      
      await trx('tax_rates').insert({
        tax_rate_id: taxRateId,
        tenant,
        rate: 0,
        name: 'Default Tax',
        description: 'Default tax rate',
        is_active: true,
        created_at: now,
        updated_at: now
      });

      // Link the tax rate to the client
      await trx('client_tax_rate').insert({
        client_id: clientId,
        tax_rate_id: taxRateId,
        tenant
      });
    } else {
      // Link existing default tax rate to the client
      await trx('client_tax_rate').insert({
        client_id: clientId,
        tax_rate_id: defaultTaxRate.tax_rate_id,
        tenant
      });
    }

    // Create default client tax settings
    await trx('client_tax_settings').insert({
      client_id: clientId,
      tenant,
      is_reverse_charge_applicable: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  // Email suffix functionality removed for security

  /**
   * Create a new client with complete validation
   * Core logic extracted from server/src/lib/actions/client-actions/clientActions.ts
   */
  static async createClient(
    input: CreateClientInput,
    tenant: string,
    trx: Knex.Transaction,
    options: ClientCreationOptions = {}
  ): Promise<IClient> {
    // Validate input
    const validation = this.validateCreateClientInput(input);
    if (!validation.valid) {
      throw new Error(`Client validation failed: ${validation.errors?.join('; ')}`);
    }

    const clientId = uuidv4();
    const now = new Date();

    // Sync website fields
    const clientData = { ...validation.data };
    if (clientData.properties?.website && !clientData.url) {
      clientData.url = clientData.properties.website;
    }
    if (clientData.url && (!clientData.properties || !clientData.properties.website)) {
      if (!clientData.properties) {
        clientData.properties = {};
      }
      clientData.properties.website = clientData.url;
    }

    // Prepare data for insertion (only include fields that exist in clients table)
    const insertData: any = {
      client_id: clientId,
      client_name: clientData.client_name,
      client_type: clientData.client_type || 'company',
      tenant,
      url: clientData.url || null,
      notes: clientData.notes || null,
      is_inactive: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      properties: clientData.properties ? JSON.stringify(clientData.properties) : null
    };

    // Add billing_email if email is provided
    if (clientData.email) {
      insertData.billing_email = clientData.email;
    }

    // Insert client
    const [client] = await trx('clients')
      .insert(insertData)
      .returning('*');
    
    // Create default tax settings if not skipped
    if (!options.skipTaxSettings) {
      try {
        await this.createDefaultTaxSettings(client.client_id, tenant, trx);
      } catch (error) {
        // Log but don't fail client creation if tax settings fail
        console.error('Failed to create default tax settings:', error);
      }
    }
    // Email suffix functionality removed for security - no automatic domain registration
    
    // Parse properties back to object if it was stringified
    if (client.properties && typeof client.properties === 'string') {
      client.properties = JSON.parse(client.properties);
    }
    
    return client as IClient;
  }

  /**
   * Update an existing client
   */
  static async updateClient(
    clientId: string,
    input: UpdateClientInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Validate input
    const validation = this.validateUpdateClientInput(input);
    if (!validation.valid) {
      throw new Error(`Client validation failed: ${validation.errors?.join('; ')}`);
    }

    const now = new Date();
    const updateData = { ...validation.data };

    // Sync website fields
    if (updateData.properties?.website && !updateData.url) {
      updateData.url = updateData.properties.website;
    }
    if (updateData.url && (!updateData.properties || !updateData.properties.website)) {
      if (!updateData.properties) {
        updateData.properties = {};
      }
      updateData.properties.website = updateData.url;
    }

    // Prepare data for update
    const dbData: any = {
      ...updateData,
      updated_at: now.toISOString()
    };

    // Convert properties to JSON if present
    if (dbData.properties) {
      dbData.properties = JSON.stringify(dbData.properties);
    }

    // Update client
    await trx('clients')
      .where({ client_id: clientId, tenant })
      .update(dbData);

    // Email suffix functionality removed for security
  }

  /**
   * Get a client by ID
   */
  static async getClientById(
    clientId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any> {
    const client = await trx('clients')
      .where({ client_id: clientId, tenant })
      .first();
    
    if (client && client.properties) {
      client.properties = JSON.parse(client.properties);
    }
    
    return client;
  }

  /**
   * Check if client exists
   */
  static async clientExists(
    clientId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    const result = await trx('clients')
      .where({ client_id: clientId, tenant })
      .count('* as count')
      .first();
    
    return parseInt(String(result?.count || 0), 10) > 0;
  }

  /**
   * Get all clients for a tenant
   */
  static async getClientsByTenant(
    tenant: string,
    trx: Knex.Transaction,
    options: { includeInactive?: boolean } = {}
  ): Promise<any[]> {
    let query = trx('clients').where({ tenant });
    
    if (!options.includeInactive) {
      query = query.where(function() {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      });
    }
    
    const clients = await query.orderBy('client_name', 'asc');
    
    // Parse properties JSON for each client
    return clients.map(client => {
      if (client.properties) {
        client.properties = JSON.parse(client.properties);
      }
      return client;
    });
  }
}