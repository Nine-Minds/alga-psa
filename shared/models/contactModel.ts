/**
 * Shared Contact Model - Core business logic for contact operations
 * This model contains the essential contact business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core contact form validation schema
export const contactFormSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone_number: z.string().optional(),
  company_id: z.string().uuid('Company ID must be a valid UUID').optional().nullable(),
  role: z.string().optional(),
  title: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
  is_inactive: z.boolean().optional(),
  portal_access: z.boolean().optional(),
  login_email: z.string().email().optional().or(z.literal('')),
  receive_emails: z.boolean().optional()
});

// Complete contact schema for validation
export const contactSchema = z.object({
  contact_name_id: z.string().uuid(),
  tenant: z.string().uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  phone_number: z.string().nullable(),
  company_id: z.string().uuid().nullable(),
  role: z.string().nullable(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  notes: z.string().nullable(),
  is_inactive: z.boolean().nullable(),
  portal_access: z.boolean().nullable(),
  login_email: z.string().nullable(),
  receive_emails: z.boolean().nullable(),
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
// INTERFACES
// =============================================================================

export interface CreateContactInput {
  full_name: string;
  email?: string;
  phone_number?: string;
  company_id?: string;
  role?: string;
  title?: string;
  department?: string;
  notes?: string;
  is_inactive?: boolean;
  portal_access?: boolean;
  login_email?: string;
  receive_emails?: boolean;
}

export interface UpdateContactInput {
  full_name?: string;
  email?: string;
  phone_number?: string;
  company_id?: string;
  role?: string;
  title?: string;
  department?: string;
  notes?: string;
  is_inactive?: boolean;
  portal_access?: boolean;
  login_email?: string;
  receive_emails?: boolean;
}

export interface CreateContactOutput {
  contact_id: string;
  full_name: string;
  email?: string;
  company_id?: string;
  tenant: string;
  created_at: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: any;
  errors?: string[];
}

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
    'email', 'phone_number', 'company_id', 'role', 
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
   */
  static async createContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<CreateContactOutput> {
    // Validate input
    const validation = this.validateCreateContactInput(input);
    if (!validation.valid) {
      throw new Error(`Contact validation failed: ${validation.errors?.join('; ')}`);
    }

    const contactId = uuidv4();
    const now = new Date();
    const contactData = validation.data;

    // Check for duplicate email if provided
    if (contactData.email) {
      const emailExists = await this.checkEmailExists(contactData.email, tenant, trx);
      if (emailExists) {
        throw new Error(`A contact with email ${contactData.email} already exists`);
      }
    }

    // Prepare data for insertion
    const insertData = {
      contact_name_id: contactId,
      tenant,
      full_name: contactData.full_name,
      email: contactData.email || null,
      phone_number: contactData.phone_number || null,
      company_id: contactData.company_id || null,
      role: contactData.role || null,
      title: contactData.title || null,
      department: contactData.department || null,
      notes: contactData.notes || null,
      is_inactive: contactData.is_inactive || false,
      portal_access: contactData.portal_access || false,
      login_email: contactData.login_email || contactData.email || null,
      receive_emails: contactData.receive_emails !== false, // Default to true
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    // Insert contact
    const [contact] = await trx('contacts')
      .insert(insertData)
      .returning('*');
    
    return {
      contact_id: contact.contact_name_id,
      full_name: contact.full_name,
      email: contact.email,
      company_id: contact.company_id,
      tenant,
      created_at: now.toISOString()
    };
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
   * Get contacts by company
   */
  static async getContactsByCompany(
    companyId: string,
    tenant: string,
    trx: Knex.Transaction,
    options: { includeInactive?: boolean } = {}
  ): Promise<any[]> {
    let query = trx('contacts')
      .where({ company_id: companyId, tenant });
    
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
    
    return result?.count > 0;
  }

  /**
   * Create or update contact (upsert)
   */
  static async upsertContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<CreateContactOutput> {
    // Try to find existing contact by email
    if (input.email) {
      const existing = await this.getContactByEmail(input.email, tenant, trx);
      if (existing) {
        // Update existing contact
        await this.updateContact(existing.contact_name_id, input, tenant, trx);
        return {
          contact_id: existing.contact_name_id,
          full_name: input.full_name || existing.full_name,
          email: input.email,
          company_id: input.company_id || existing.company_id,
          tenant,
          created_at: existing.created_at
        };
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