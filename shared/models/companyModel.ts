/**
 * Shared Company Model - Core business logic for company operations
 * This model contains the essential company business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ICompany } from '../../server/src/interfaces/company.interfaces';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core company form validation schema extracted from server actions
export const companyFormSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  client_type: z.enum(['company', 'individual']).optional(),
  url: z.string().url().optional().or(z.literal('')),
  phone_no: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  properties: z.record(z.any()).optional(),
  parent_company_id: z.string().uuid().optional().nullable(),
  plan_id: z.string().uuid().optional().nullable()
});

// Complete company schema for validation
export const companySchema = z.object({
  company_id: z.string().uuid(),
  company_name: z.string(),
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
  parent_company_id: z.string().uuid().nullable(),
  plan_id: z.string().uuid().nullable(),
  is_default: z.boolean().nullable()
});

// Company update schema
export const companyUpdateSchema = companySchema.partial().omit({
  company_id: true,
  tenant: true,
  created_at: true
});

// =============================================================================
// INTERFACES
// =============================================================================

export interface CreateCompanyInput {
  company_name: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  properties?: Record<string, any>;
  parent_company_id?: string;
  plan_id?: string;
  is_default?: boolean;
}

export interface UpdateCompanyInput {
  company_name?: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  is_inactive?: boolean;
  properties?: Record<string, any>;
  parent_company_id?: string;
  plan_id?: string;
}

// CreateCompanyOutput removed - now returns ICompany directly

export interface CompanyCreationOptions {
  skipTaxSettings?: boolean;
  skipEmailSuffix?: boolean;
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
    'url', 'phone_no', 'email', 'address', 'address_2', 
    'city', 'state', 'zip', 'country', 'notes', 
    'parent_company_id', 'plan_id'
  ];
  
  for (const field of nullableFields) {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  }
  
  return cleaned;
}

// =============================================================================
// CORE COMPANY MODEL
// =============================================================================

export class CompanyModel {
  /**
   * Validates company creation input
   */
  static validateCreateCompanyInput(input: CreateCompanyInput): ValidationResult {
    try {
      // Basic required field validation
      if (!input.company_name || input.company_name.trim() === '') {
        return { valid: false, errors: ['Company name is required'] };
      }

      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(companyFormSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Validates company update input
   */
  static validateUpdateCompanyInput(input: UpdateCompanyInput): ValidationResult {
    try {
      // Clean nullable fields
      const cleanedInput = cleanNullableFields(input);
      
      // Validate with schema
      const validatedData = validateData(companyUpdateSchema, cleanedInput);
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Extract domain from URL
   */
  static extractDomainFromUrl(url: string): string | null {
    try {
      // Add protocol if missing
      let urlWithProtocol = url;
      if (!url.match(/^https?:\/\//)) {
        urlWithProtocol = `https://${url}`;
      }
      
      const urlObj = new URL(urlWithProtocol);
      const hostname = urlObj.hostname;
      
      // Remove 'www.' if present
      return hostname.replace(/^www\./, '');
    } catch (error) {
      console.error('Error extracting domain from URL:', error);
      return null;
    }
  }

  /**
   * Create default tax settings for a company
   * Delegates to TaxService for consistency with existing implementation
   */
  static async createDefaultTaxSettings(
    companyId: string,
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

      // Link the tax rate to the company
      await trx('company_tax_rate').insert({
        company_id: companyId,
        tax_rate_id: taxRateId,
        tenant
      });
    } else {
      // Link existing default tax rate to the company
      await trx('company_tax_rate').insert({
        company_id: companyId,
        tax_rate_id: defaultTaxRate.tax_rate_id,
        tenant
      });
    }

    // Create default company tax settings
    await trx('company_tax_settings').insert({
      company_id: companyId,
      tenant,
      is_reverse_charge_applicable: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  /**
   * Add company email setting (domain suffix)
   * Extracted from server/src/lib/actions/company-settings/emailSettings.ts
   */
  static async addCompanyEmailSetting(
    companyId: string,
    domain: string,
    tenant: string,
    trx: Knex.Transaction,
    selfRegistrationEnabled: boolean = true
  ): Promise<void> {
    const settingId = uuidv4();
    const now = new Date().toISOString();
    
    // Check if suffix already exists for this company
    const existing = await trx('company_email_settings')
      .where({
        tenant,
        company_id: companyId,
        email_suffix: domain
      })
      .first();
    
    if (!existing) {
      await trx('company_email_settings').insert({
        setting_id: settingId,
        company_id: companyId,
        tenant,
        email_suffix: domain,
        self_registration_enabled: selfRegistrationEnabled,
        created_at: now,
        updated_at: now
      });
    }
  }

  /**
   * Create a new company with complete validation
   * Core logic extracted from server/src/lib/actions/company-actions/companyActions.ts
   */
  static async createCompany(
    input: CreateCompanyInput,
    tenant: string,
    trx: Knex.Transaction,
    options: CompanyCreationOptions = {}
  ): Promise<ICompany> {
    // Validate input
    const validation = this.validateCreateCompanyInput(input);
    if (!validation.valid) {
      throw new Error(`Company validation failed: ${validation.errors?.join('; ')}`);
    }

    const companyId = uuidv4();
    const now = new Date();

    // Sync website fields
    const companyData = { ...validation.data };
    if (companyData.properties?.website && !companyData.url) {
      companyData.url = companyData.properties.website;
    }
    if (companyData.url && (!companyData.properties || !companyData.properties.website)) {
      if (!companyData.properties) {
        companyData.properties = {};
      }
      companyData.properties.website = companyData.url;
    }

    // Prepare data for insertion
    const insertData = {
      company_id: companyId,
      company_name: companyData.company_name,
      client_type: companyData.client_type || 'company',
      tenant,
      url: companyData.url || null,
      phone_no: companyData.phone_no || null,
      email: companyData.email || null,
      address: companyData.address || null,
      address_2: companyData.address_2 || null,
      city: companyData.city || null,
      state: companyData.state || null,
      zip: companyData.zip || null,
      country: companyData.country || null,
      notes: companyData.notes || null,
      is_inactive: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      properties: companyData.properties ? JSON.stringify(companyData.properties) : null,
      parent_company_id: companyData.parent_company_id || null,
      plan_id: companyData.plan_id || null,
      is_default: companyData.is_default || false
    };

    // Insert company
    const [company] = await trx('companies')
      .insert(insertData)
      .returning('*');
    
    // Create default tax settings if not skipped
    if (!options.skipTaxSettings) {
      try {
        await this.createDefaultTaxSettings(company.company_id, tenant, trx);
      } catch (error) {
        // Log but don't fail company creation if tax settings fail
        console.error('Failed to create default tax settings:', error);
      }
    }
    
    // Add website domain as email suffix if available and not skipped
    if (!options.skipEmailSuffix) {
      const websiteUrl = company.url || company.properties?.website;
      if (websiteUrl) {
        const domain = this.extractDomainFromUrl(websiteUrl);
        if (domain) {
          try {
            await this.addCompanyEmailSetting(
              company.company_id, 
              domain, 
              tenant, 
              trx,
              true // self-registration enabled by default
            );
          } catch (error) {
            // Log error but don't fail company creation
            console.error('Failed to add website domain as email suffix:', error);
          }
        }
      }
    }
    
    // Parse properties back to object if it was stringified
    if (company.properties && typeof company.properties === 'string') {
      company.properties = JSON.parse(company.properties);
    }
    
    return company as ICompany;
  }

  /**
   * Update an existing company
   */
  static async updateCompany(
    companyId: string,
    input: UpdateCompanyInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    // Validate input
    const validation = this.validateUpdateCompanyInput(input);
    if (!validation.valid) {
      throw new Error(`Company validation failed: ${validation.errors?.join('; ')}`);
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

    // Update company
    await trx('companies')
      .where({ company_id: companyId, tenant })
      .update(dbData);

    // Update email suffix if URL changed
    if (updateData.url) {
      const domain = this.extractDomainFromUrl(updateData.url);
      if (domain) {
        await this.addCompanyEmailSetting(companyId, domain, tenant, trx);
      }
    }
  }

  /**
   * Get a company by ID
   */
  static async getCompanyById(
    companyId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any> {
    const company = await trx('companies')
      .where({ company_id: companyId, tenant })
      .first();
    
    if (company && company.properties) {
      company.properties = JSON.parse(company.properties);
    }
    
    return company;
  }

  /**
   * Check if company exists
   */
  static async companyExists(
    companyId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    const result = await trx('companies')
      .where({ company_id: companyId, tenant })
      .count('* as count')
      .first();
    
    return result?.count > 0;
  }

  /**
   * Get all companies for a tenant
   */
  static async getCompaniesByTenant(
    tenant: string,
    trx: Knex.Transaction,
    options: { includeInactive?: boolean } = {}
  ): Promise<any[]> {
    let query = trx('companies').where({ tenant });
    
    if (!options.includeInactive) {
      query = query.where(function() {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      });
    }
    
    const companies = await query.orderBy('company_name', 'asc');
    
    // Parse properties JSON for each company
    return companies.map(company => {
      if (company.properties) {
        company.properties = JSON.parse(company.properties);
      }
      return company;
    });
  }
}