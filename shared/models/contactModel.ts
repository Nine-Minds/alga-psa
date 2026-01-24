/**
 * Shared Contact Model - Core business logic for contact operations
 * This model contains the essential contact business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { 
  IContact, 
  CreateContactInput, 
  UpdateContactInput 
} from '../interfaces/contact.interfaces';
import { ValidationResult } from '../interfaces/validation.interfaces';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core contact form validation schema
export const contactFormSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.union([z.string().email('Invalid email address'), z.literal(''), z.null()]).optional(),
  phone_number: z.string().optional(),
  client_id: z.string().uuid('Client ID must be a valid UUID').optional().nullable(),
  role: z.string().optional(),
  notes: z.string().optional(),
  is_inactive: z.boolean().optional()
});

// Complete contact schema for validation
export const contactSchema = z.object({
  contact_name_id: z.string().uuid(),
  tenant: z.string().uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  phone_number: z.string().nullable(),
  client_id: z.string().uuid().nullable(),
  role: z.string().nullable(),
  notes: z.string().nullable(),
  is_inactive: z.boolean().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

// Contact update schema
export const contactUpdateSchema = contactSchema.partial().omit({
  contact_name_id: true,
  tenant: true,
  created_at: true
});

// =============================================================================
// Re-export interfaces for backward compatibility
// =============================================================================

export type { 
  IContact, 
  CreateContactInput, 
  UpdateContactInput 
} from '../interfaces/contact.interfaces';
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
    'email', 'phone_number', 'client_id', 'role', 
    'title', 'department', 'notes', 'login_email'
  ];
  
  for (const field of nullableFields) {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  }
  
  return cleaned;
}

/**
 * Parse name into first and last name components
 */
export function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const nameParts = fullName.trim().split(/\s+/);
  
  if (nameParts.length === 1) {
    return {
      firstName: nameParts[0],
      lastName: ''
    };
  }
  
  // Take first part as first name, rest as last name
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');
  
  return { firstName, lastName };
}

// =============================================================================
// CORE CONTACT MODEL
// =============================================================================

export class ContactModel {
  /**
   * Validates contact creation input
   */
  static validateCreateContactInput(input: CreateContactInput): ValidationResult {
    try {
      // Basic required field validation
      if (!input.full_name || input.full_name.trim() === '') {
        return { valid: false, errors: ['Full name is required'] };
      }

      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(contactFormSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Validates contact update input
   */
  static validateUpdateContactInput(input: UpdateContactInput): ValidationResult {
    try {
      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(contactUpdateSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Check if email already exists for another contact
   */
  static async checkEmailExists(
    email: string,
    tenant: string,
    trx: Knex.Transaction,
    excludeContactId?: string
  ): Promise<boolean> {
    let query = trx('contacts')
      .where({ email, tenant });
    
    if (excludeContactId) {
      query = query.whereNot('contact_name_id', excludeContactId);
    }
    
    const existing = await query.first();
    return !!existing;
  }

  /**
   * Create a new contact with complete validation
   * Core logic extracted from @alga-psa/clients/actions   */
  static async createContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact> {
    // Validate required fields with specific messages
    if (!input.full_name?.trim() && !input.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name and email address are required');
    }
    if (!input.full_name?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name is required');
    }
    if (!input.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Email address is required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.email.trim())) {
      throw new Error('VALIDATION_ERROR: Please enter a valid email address');
    }

    // Check if email already exists
    const existingContact = await trx('contacts')
      .where({ email: input.email.trim().toLowerCase(), tenant })
      .first();

    if (existingContact) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }

    // If client_id is provided, verify it exists
    if (input.client_id) {
      const client = await trx('clients')
        .where({ client_id: input.client_id, tenant })
        .first();

      if (!client) {
        throw new Error('FOREIGN_KEY_ERROR: The selected client no longer exists');
      }
    }

    const contactId = uuidv4();
    const now = new Date();

    // Prepare contact data with proper sanitization
    const insertData = {
      contact_name_id: contactId,
      tenant,
      full_name: input.full_name.trim(),
      email: input.email.trim().toLowerCase(),
      phone_number: input.phone_number?.trim() || null,
      client_id: input.client_id || null,
      role: input.role?.trim() || null,
      notes: input.notes?.trim() || null,
      is_inactive: input.is_inactive || false,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    try {
      // Insert contact
      const [contact] = await trx('contacts')
        .insert(insertData)
        .returning('*');
      
      if (!contact) {
        throw new Error('SYSTEM_ERROR: Failed to create contact record');
      }

      return contact as IContact;
    } catch (err) {
      // Log the error for debugging
      console.error('Error creating contact:', err);

      // Handle known error types
      if (err instanceof Error) {
        const message = err.message;

        // If it's already one of our formatted errors, rethrow it
        if (message.includes('VALIDATION_ERROR:') ||
          message.includes('EMAIL_EXISTS:') ||
          message.includes('FOREIGN_KEY_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
          throw err;
        }

        // Handle database-specific errors
        if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
          throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
        }

        if (message.includes('violates not-null constraint')) {
          const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
          throw new Error(`VALIDATION_ERROR: The ${field} is required`);
        }

        if (message.includes('violates foreign key constraint') && message.includes('client_id')) {
          throw new Error('FOREIGN_KEY_ERROR: The selected client is no longer valid');
        }
      }

      // For unexpected errors, throw a generic system error
      throw new Error('SYSTEM_ERROR: An unexpected error occurred while creating the contact');
    }
  }

  /**
   * Update an existing contact
   */
  static async updateContact(
    contactId: string,
    input: UpdateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Validate input
    const validation = this.validateUpdateContactInput(input);
    if (!validation.valid) {
      throw new Error(`Contact validation failed: ${validation.errors?.join('; ')}`);
    }

    const now = new Date();
    const updateData = validation.data;

    // Check for duplicate email if email is being updated
    if (updateData.email) {
      const emailExists = await this.checkEmailExists(updateData.email, tenant, trx, contactId);
      if (emailExists) {
        throw new Error(`A contact with email ${updateData.email} already exists`);
      }
    }

    // Prepare data for update
    const dbData = {
      ...updateData,
      updated_at: now.toISOString()
    };

    // Update contact
    await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .update(dbData);
  }

  /**
   * Get a contact by ID
   */
  static async getContactById(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any> {
    return await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();
  }

  /**
   * Get contacts by client
   */
  static async getContactsByClient(
    clientId: string,
    tenant: string,
    trx: Knex.Transaction,
    options: { includeInactive?: boolean } = {}
  ): Promise<any[]> {
    let query = trx('contacts')
      .where({ client_id: clientId, tenant });
    
    if (!options.includeInactive) {
      query = query.where(function() {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      });
    }
    
    return await query.orderBy('full_name', 'asc');
  }

  /**
   * Get contact by email
   */
  static async getContactByEmail(
    email: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any> {
    return await trx('contacts')
      .where({ email, tenant })
      .first();
  }

  /**
   * Check if contact exists
   */
  static async contactExists(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    const result = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .count('* as count')
      .first();
    
    return parseInt(String(result?.count || 0), 10) > 0;
  }

  /**
   * Create or update contact (upsert)
   */
  static async upsertContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact> {
    // Try to find existing contact by email
    if (input.email) {
      const existing = await this.getContactByEmail(input.email, tenant, trx);
      if (existing) {
        // Update existing contact
        await this.updateContact(existing.contact_name_id, input, tenant, trx);
        // Return the updated contact
        return await this.getContactById(existing.contact_name_id, tenant, trx);
      }
    }
    
    // Create new contact
    return await this.createContact(input, tenant, trx);
  }

  /**
   * Search contacts by name or email
   */
  static async searchContacts(
    searchTerm: string,
    tenant: string,
    trx: Knex.Transaction,
    options: { limit?: number; includeInactive?: boolean } = {}
  ): Promise<any[]> {
    let query = trx('contacts')
      .where('tenant', tenant)
      .where(function() {
        this.where('full_name', 'ilike', `%${searchTerm}%`)
          .orWhere('email', 'ilike', `%${searchTerm}%`);
      });
    
    if (!options.includeInactive) {
      query = query.where(function() {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    return await query.orderBy('full_name', 'asc');
  }
}