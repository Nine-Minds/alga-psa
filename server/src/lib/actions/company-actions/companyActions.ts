'use server'

import { ICompany, ICompanyWithLocation } from 'server/src/interfaces/company.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { createDefaultTaxSettings } from '../taxSettingsActions';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getCompanyLogoUrl, getCompanyLogoUrlsBatch } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { addCompanyEmailSetting } from '../company-settings/emailSettings';
import { deleteEntityTags } from '../../utils/tagCleanup';
import { createTag } from '../tagActions';

// Helper function to extract domain from URL
function extractDomainFromUrl(url: string): string | null {
  if (!url) return null;
  
  try {
    // Add protocol if missing
    let urlWithProtocol = url;
    if (!url.match(/^https?:\/\//)) {
      urlWithProtocol = `https://${url}`;
    }
    
    const urlObj = new URL(urlWithProtocol);
    // Remove 'www.' prefix if present
    return urlObj.hostname.replace(/^www\./, '');
  } catch (error) {
    // If URL parsing fails, try basic extraction
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/);
    return match ? match[1] : null;
  }
}

export async function getCompanyById(companyId: string): Promise<ICompanyWithLocation | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot read companies');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Fetch company data with account manager info and location data
  const companyData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('companies as c')
      .leftJoin('users as u', function() {
        this.on('c.account_manager_id', '=', 'u.user_id')
            .andOn('c.tenant', '=', 'u.tenant');
      })
      .leftJoin('company_locations as cl', function() {
        this.on('c.company_id', '=', 'cl.company_id')
            .andOn('c.tenant', '=', 'cl.tenant')
            .andOn('cl.is_default', '=', trx.raw('true'));
      })
      .select(
        'c.*',
        'cl.email as location_email',
        'cl.phone as location_phone',
        'cl.address_line1 as location_address',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      )
      .where({ 'c.company_id': companyId, 'c.tenant': tenant })
      .first();
  });

  if (!companyData) {
    return null;
  }

  // Get the company logo URL using the utility function
  const logoUrl = await getCompanyLogoUrl(companyId, tenant);

  return {
    ...companyData,
    logoUrl,
  } as ICompanyWithLocation;
}

export async function updateCompany(companyId: string, updateData: Partial<Omit<ICompany, 'account_manager_full_name'>>): Promise<ICompany> { // Omit joined field from update type
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company updating
  if (!await hasPermission(currentUser, 'company', 'update')) {
    throw new Error('Permission denied: Cannot update companies');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    console.log('Updating company in database:', companyId, updateData);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build update object with explicit null handling
      const updateObject: any = {
        updated_at: new Date().toISOString()
      };

      // First, get the current company data to properly merge properties
      const currentCompany = await trx<ICompany>('companies')
        .where({ company_id: companyId, tenant })
        .first();
      
      if (!currentCompany) {
        throw new Error('Company not found');
      }

      // Handle properties separately
      if (updateData.properties) {
        const currentProperties = currentCompany.properties || {};
        const newProperties = updateData.properties;
        
        updateObject.properties = { ...currentProperties, ...newProperties };
        
        // Sync website field with url if website is being updated
        if ('website' in newProperties) {
          updateObject.url = newProperties.website || '';
        }
      }
      
      // Handle url field to sync with properties.website
      if (updateData.url !== undefined) {
        updateObject.url = updateData.url;
        
        // Update properties.website to match url
        if (!updateObject.properties) {
          updateObject.properties = {
            ...(currentCompany.properties || {}),
            website: updateData.url
          };
        } else {
          updateObject.properties = {
            ...updateObject.properties,
            website: updateData.url
          };
        }
      }
      
      // Handle all other fields
      Object.entries(updateData).forEach(([key, value]) => {
        // Exclude properties, url, tax_region, account_manager_id, and logoUrl (computed field)
        const excludedFields = ['properties', 'url', 'tax_region', 'account_manager_id', 'logoUrl'];
        if (!excludedFields.includes(key)) {
          // Always include the field in the update, setting null for undefined/empty values
          updateObject[key] = (value === undefined || value === '') ? null : value;
        }
      });

      // Explicitly set fields to null if they're not in updateData but should be cleared
      if (!updateData.hasOwnProperty('billing_contact_id')) {
        updateObject.billing_contact_id = null;
      }
      if (!updateData.hasOwnProperty('billing_email')) {
        updateObject.billing_email = null;
      }
      
      if (updateData.hasOwnProperty('account_manager_id')) {
          updateObject.account_manager_id = updateData.account_manager_id === '' ? null : updateData.account_manager_id;
      }

      await trx('companies')
        .where({ company_id: companyId, tenant })
        .update(updateObject);

      // If the company is being set to inactive, update all associated contacts
      if (updateData.is_inactive === true) {
        await trx('contacts')
          .where({ company_id: companyId, tenant })
          .update({ is_inactive: true });
      }
    });

    // If URL was updated, try to add the domain as email suffix
    if (updateData.url !== undefined || updateData.properties?.website !== undefined) {
      const websiteUrl = updateData.url || updateData.properties?.website;
      if (websiteUrl) {
        const domain = extractDomainFromUrl(websiteUrl);
        if (domain) {
          try {
            await addCompanyEmailSetting(
              companyId,
              domain,
              true // self-registration enabled by default
            );
          } catch (error) {
            // Log error but don't fail company update
            console.error('Failed to add website domain as email suffix:', error);
          }
        }
      }
    }

    // Fetch and return the updated company data including logoUrl
    const updatedCompanyWithLogo = await getCompanyById(companyId);
    if (!updatedCompanyWithLogo) {
        throw new Error('Failed to fetch updated company data');
    }

    console.log('Updated company data:', updatedCompanyWithLogo);
    return updatedCompanyWithLogo;
  } catch (error) {
    console.error('Error updating company:', error);
    throw new Error('Failed to update company');
  }
}

export async function createCompany(company: Omit<ICompany, 'company_id' | 'created_at' | 'updated_at' | 'account_manager_full_name'>): Promise<{ success: true; data: ICompany } | { success: false; error: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company creation
  if (!await hasPermission(currentUser, 'company', 'create')) {
    throw new Error('Permission denied: Cannot create companies');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Ensure website field is synchronized between properties.website and url
    const companyData = { ...company };
    
    // If properties.website exists but url doesn't, sync url from properties.website
    if (companyData.properties?.website && !companyData.url) {
      companyData.url = companyData.properties.website;
    }
    
    // If url exists but properties.website doesn't, sync properties.website from url
    if (companyData.url && (!companyData.properties || !companyData.properties.website)) {
      if (!companyData.properties) {
        companyData.properties = {};
      }
      companyData.properties.website = companyData.url;
    }

    const createdCompany = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [created] = await trx<ICompany>('companies')
        .insert({
          ...companyData,
          tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');
        
      return created;
    });

    if (!createdCompany) {
      throw new Error('Failed to create company');
    }

    // Create default tax settings for the new company
    await createDefaultTaxSettings(createdCompany.company_id);

    // Add website domain as email suffix if available
    const websiteUrl = createdCompany.url || createdCompany.properties?.website;
    if (websiteUrl) {
      const domain = extractDomainFromUrl(websiteUrl);
      if (domain) {
        try {
          await addCompanyEmailSetting(
            createdCompany.company_id,
            domain,
            true // self-registration enabled by default
          );
        } catch (error) {
          // Log error but don't fail company creation
          console.error('Failed to add website domain as email suffix:', error);
        }
      }
    }

    return { success: true, data: createdCompany };
  } catch (error: any) {
    console.error('Error creating company:', error);
    
    // Handle specific database constraint violations
    if (error.code === '23505') { // PostgreSQL unique constraint violation
      if (error.constraint && error.constraint.includes('companies_tenant_company_name_unique')) {
        return { success: false, error: `A company with the name "${company.company_name}" already exists. Please choose a different name.` };
      } else {
        return { success: false, error: 'A company with these details already exists. Please check the company name.' };
      }
    }
    
    // Handle other database errors
    if (error.code === '23514') { // Check constraint violation
      return { success: false, error: 'Invalid data provided. Please check all fields and try again.' };
    }
    
    if (error.code === '23503') { // Foreign key constraint violation
      return { success: false, error: 'Referenced data not found. Please check account manager selection.' };
    }
    
    
    // Re-throw system errors (these should still be 500)
    if (error.message && !error.code) {
      throw error;
    }
    
    // Default fallback for system errors
    throw new Error('Failed to create company. Please try again.');
  }
}

// Pagination interface
export interface CompanyPaginationParams {
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  searchTerm?: string;
  clientTypeFilter?: 'all' | 'company' | 'individual';
  loadLogos?: boolean; // Option to load logos or not
  selectedTags?: string[]; // Filter by tags
  /**
   * Optional status filter. Overrides includeInactive if provided.
   *  - 'active'   -> only active companies
   *  - 'inactive' -> only inactive companies
   *  - 'all'      -> include both active and inactive
   */
  statusFilter?: 'all' | 'active' | 'inactive';
}

export interface PaginatedCompaniesResponse {
  companies: ICompany[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getAllCompaniesPaginated(params: CompanyPaginationParams = {}): Promise<PaginatedCompaniesResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot read companies');
  }

  const {
    page = 1,
    pageSize = 10,
    includeInactive = true,
    searchTerm,
    clientTypeFilter = 'all',
    loadLogos = true,
    statusFilter,
    selectedTags
  } = params;

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const offset = (page - 1) * pageSize;

    // Use a transaction to get paginated company data
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build the base query with company_locations join
      let baseQuery = trx('companies as c')
        .leftJoin('users as u', function() {
          this.on('c.account_manager_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .leftJoin('company_locations as cl', function() {
          this.on('c.company_id', '=', 'cl.company_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .where({ 'c.tenant': tenant });

      if (statusFilter === 'active') {
        baseQuery = baseQuery.andWhere('c.is_inactive', false);
      } else if (statusFilter === 'inactive') {
        baseQuery = baseQuery.andWhere('c.is_inactive', true);
      } else if (!statusFilter && !includeInactive) {
        baseQuery = baseQuery.andWhere('c.is_inactive', false);
      }

      // Apply filters
      if (searchTerm) {
        baseQuery = baseQuery.where(function() {
          this.where('c.company_name', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.phone', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.address_line1', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.address_line2', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.city', 'ilike', `%${searchTerm}%`);
        });
      }

      if (clientTypeFilter !== 'all') {
        baseQuery = baseQuery.where('c.client_type', clientTypeFilter);
      }

      // Apply tag filter using new tag structure
      if (selectedTags && selectedTags.length > 0) {
        baseQuery = baseQuery.whereIn('c.company_id', function() {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'company')
            .where('tm.tenant', tenant)
            .whereIn('td.tag_text', selectedTags);
        });
      }

      // Get total count
      const countResult = await baseQuery.clone().count('* as count').first();
      const totalCount = parseInt(countResult?.count as string || '0', 10);

      // Get paginated companies with location data
      const companies = await baseQuery
        .select(
          'c.*',
          trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`),
          'cl.phone as location_phone',
          'cl.email as location_email',
          'cl.address_line1',
          'cl.address_line2',
          'cl.city',
          'cl.state_province',
          'cl.postal_code',
          'cl.country_name'
        )
        .orderBy('c.company_name', 'asc')
        .limit(pageSize)
        .offset(offset);

      return { companies, totalCount };
    });

    // Process companies to add logoUrl if requested
    let companiesWithLogos = result.companies;
    
    if (loadLogos && companiesWithLogos.length > 0) {
      const companyIds = companiesWithLogos.map(c => c.company_id);
      const logoUrlsMap = await getCompanyLogoUrlsBatch(companyIds, tenant);
      
      companiesWithLogos = companiesWithLogos.map((company) => ({
        ...company,
        properties: company.properties || {},
        logoUrl: logoUrlsMap.get(company.company_id) || null,
      }));
    } else {
      // If not loading logos, ensure logoUrl is null
      companiesWithLogos = companiesWithLogos.map((company) => ({
        ...company,
        properties: company.properties || {},
        logoUrl: null,
      }));
    }

    return {
      companies: companiesWithLogos as ICompany[],
      totalCount: result.totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(result.totalCount / pageSize)
    };
  } catch (error) {
    console.error('Error fetching paginated companies:', error);
    throw error;
  }
}

export async function getAllCompanies(includeInactive: boolean = true): Promise<ICompany[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot read companies');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Use a transaction to get all company data
    const { companiesData, fileIdMap } = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Start building the query
      let baseQuery = trx('companies as c')
        .leftJoin('users as u', function() {
          this.on('c.account_manager_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .where({ 'c.tenant': tenant });

      if (!includeInactive) {
        baseQuery = baseQuery.andWhere('c.is_inactive', false);
      }

      // Get unique companies with document associations and account manager info
      const companies = await baseQuery
        .select(
          'c.*',
          trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`),
          trx.raw(
            `(SELECT document_id 
            FROM document_associations da 
            WHERE da.entity_id = c.company_id 
            AND da.entity_type = 'company'
            AND da.tenant = '${tenant}'
            LIMIT 1) as document_id`)
        );

      // Fetch file_ids for logos
      const documentIds = companies
        .map(c => c.document_id)
        .filter((id): id is string => !!id); // Filter out null/undefined IDs

      let fileIds: Record<string, string> = {};
      if (documentIds.length > 0) {
        const fileRecords = await trx('documents')
          .select('document_id', 'file_id')
          .whereIn('document_id', documentIds)
          .andWhere({ tenant });
        
        fileIds = fileRecords.reduce((acc, record) => {
          if (record.file_id) {
            acc[record.document_id] = record.file_id;
          }
          return acc;
        }, {} as Record<string, string>);
      }

      return { companiesData: companies, fileIdMap: fileIds };
    });

    // Process companies to add logoUrl using batch loading
    const companyIds = companiesData.map(c => c.company_id);
    const logoUrlsMap = await getCompanyLogoUrlsBatch(companyIds, tenant);
    
    const companiesWithLogos = companiesData.map((companyData) => {
      const logoUrl = logoUrlsMap.get(companyData.company_id) || null;
      
      // Remove the temporary document_id before returning
      const { document_id, ...company } = companyData;
      return {
        ...company,
        properties: company.properties || {},
        logoUrl,
      };
    });

    return companiesWithLogos as ICompany[];
  } catch (error) {
    console.error('Error fetching all companies:', error);
    throw new Error('Failed to fetch all companies');
  }
}

export async function deleteCompany(companyId: string): Promise<{ 
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
}> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company deletion
  if (!await hasPermission(currentUser, 'company', 'delete')) {
    throw new Error('Permission denied: Cannot delete companies');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // First verify the company exists and belongs to this tenant
    const company = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('companies')
        .where({ company_id: companyId, tenant })
        .first();
    });
    
    if (!company) {
      return {
        success: false,
        message: 'Company not found'
      };
    }

    console.log('Checking dependencies for company:', companyId, 'tenant:', tenant);

    // Check for dependencies
    const dependencies: string[] = [];
    const counts: Record<string, number> = {};

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check for contacts
      const contactCount = await trx('contacts')
        .where({ company_id: companyId, tenant })
        .count('contact_name_id as count')
        .first();
      console.log('Contact count result:', contactCount);
      if (contactCount && Number(contactCount.count) > 0) {
        dependencies.push('contact');
        counts['contact'] = Number(contactCount.count);
      }

      // Check for active tickets
      const ticketCount = await trx('tickets')
        .where({ company_id: companyId, tenant, is_closed: false })
        .count('ticket_id as count')
        .first();
      console.log('Ticket count result:', ticketCount);
      if (ticketCount && Number(ticketCount.count) > 0) {
        dependencies.push('ticket');
        counts['ticket'] = Number(ticketCount.count);
      }

      // Check for projects
      const projectCount = await trx('projects')
        .where({ company_id: companyId, tenant })
        .count('project_id as count')
        .first();
      console.log('Project count result:', projectCount);
      if (projectCount && Number(projectCount.count) > 0) {
        dependencies.push('project');
        counts['project'] = Number(projectCount.count);
      }

      // Check for documents using document_associations table
      const documentCount = await trx('document_associations')
        .where({ 
          entity_id: companyId, 
          entity_type: 'company', 
          tenant 
        })
        .count('document_id as count')
        .first();
      console.log('Document count result:', documentCount);
      if (documentCount && Number(documentCount.count) > 0) {
        dependencies.push('document');
        counts['document'] = Number(documentCount.count);
      }

      // Check for invoices
      const invoiceCount = await trx('invoices')
        .where({ company_id: companyId, tenant })
        .count('invoice_id as count')
        .first();
      console.log('Invoice count result:', invoiceCount);
      if (invoiceCount && Number(invoiceCount.count) > 0) {
        dependencies.push('invoice');
        counts['invoice'] = Number(invoiceCount.count);
      }

      // Check for interactions
      const interactionCount = await trx('interactions')
        .where({ company_id: companyId, tenant })
        .count('interaction_id as count')
        .first();
      console.log('Interaction count result:', interactionCount);
      if (interactionCount && Number(interactionCount.count) > 0) {
        dependencies.push('interaction');
        counts['interaction'] = Number(interactionCount.count);
      }

      // Check for locations
      const locationCount = await trx('company_locations')
        .join('companies', 'companies.company_id', 'company_locations.company_id')
        .where({ 
          'company_locations.company_id': companyId,
          'companies.tenant': tenant 
        })
        .count('* as count')
        .first();
      console.log('Location count result:', locationCount);
      if (locationCount && Number(locationCount.count) > 0) {
        dependencies.push('location');
        counts['location'] = Number(locationCount.count);
      }

      // Check for service usage
      const usageCount = await trx('usage_tracking')
        .where({ company_id: companyId, tenant })
        .count('usage_id as count')
        .first();
      console.log('Usage count result:', usageCount);
      if (usageCount && Number(usageCount.count) > 0) {
        dependencies.push('service_usage');
        counts['service_usage'] = Number(usageCount.count);
      }

      // Check for billing plans
      const billingPlanCount = await trx('company_billing_plans')
        .where({ company_id: companyId, tenant })
        .count('company_billing_plan_id as count')
        .first();
      console.log('Billing plan count result:', billingPlanCount);
      if (billingPlanCount && Number(billingPlanCount.count) > 0) {
        dependencies.push('billing_plan');
        counts['billing_plan'] = Number(billingPlanCount.count);
      }

      // Check for bucket usage
      const bucketUsageCount = await trx('bucket_usage')
        .where({ company_id: companyId, tenant })
        .count('usage_id as count')
        .first();
      console.log('Bucket usage count result:', bucketUsageCount);
      if (bucketUsageCount && Number(bucketUsageCount.count) > 0) {
        dependencies.push('bucket_usage');
        counts['bucket_usage'] = Number(bucketUsageCount.count);
      }
    });

    // We're automatically deleting tax rates and settings when deleting the company,
    // so we don't need to check them as dependencies

    // If there are dependencies, return error with details
    if (dependencies.length > 0) {
      const readableTypes: Record<string, string> = {
        'contact': 'contacts',
        'ticket': 'active tickets',
        'project': 'active projects',
        'document': 'documents',
        'invoice': 'invoices',
        'interaction': 'interactions',
        'location': 'locations',
        'service_usage': 'service usage records',
        'bucket_usage': 'bucket usage records',
        'billing_plan': 'billing plans'
      };

      return {
        success: false,
        code: 'COMPANY_HAS_DEPENDENCIES',
        message: 'Company has associated records and cannot be deleted',
        dependencies: dependencies.map((dep: string): string => readableTypes[dep] || dep),
        counts
      };
    }

    // If no dependencies, proceed with deletion
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Delete associated tags first
      await deleteEntityTags(trx, companyId, 'company');

      // Delete company tax settings
      await trx('company_tax_settings')
        .where({ company_id: companyId, tenant })
        .delete();
      
      // Delete company tax rates
      await trx('company_tax_rates')
        .where({ company_id: companyId, tenant })
        .delete();

      // Delete the company
      const deleted = await trx('companies')
        .where({ company_id: companyId, tenant })
        .delete();

      if (!deleted) {
        throw new Error('Company not found');
      }

      return { success: true };
    });

    return result;
  } catch (error) {
    console.error('Error deleting company:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete company'
    };
  }
}


export async function exportCompaniesToCSV(companies: ICompany[]): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading (export is a read operation)
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot export companies');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const exportData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Fetch location data for all companies
    const companyIds = companies.map(c => c.company_id);
    const locations = await trx('company_locations')
      .whereIn('company_id', companyIds)
      .andWhere('tenant', tenant)
      .andWhere('is_default', true);

    // Create a map of company_id to location
    const locationMap = new Map();
    locations.forEach(loc => {
      locationMap.set(loc.company_id, loc);
    });

    // Fetch tags for all companies
    const { findTagsByEntityIds } = await import('../tagActions');
    const tags = await findTagsByEntityIds(companyIds, 'company');
    
    // Create a map of company_id to tags
    const tagMap = new Map<string, string[]>();
    tags.forEach(tag => {
      if (!tagMap.has(tag.tagged_id)) {
        tagMap.set(tag.tagged_id, []);
      }
      tagMap.get(tag.tagged_id)!.push(tag.tag_text);
    });

    // Prepare export data with location fields
    return companies.map(company => {
      const location = locationMap.get(company.company_id) || {};
      const companyTags = tagMap.get(company.company_id) || [];
      const tagNames = companyTags.join(', ');
      
      return {
        client_name: company.company_name,
        website: company.url || '',
        client_type: company.client_type || 'company',
        is_inactive: company.is_inactive ? 'true' : 'false',
        notes: company.notes || '',
        tags: tagNames,
        // Location fields
        location_name: location.location_name || '',
        email: location.email || '',
        phone_number: location.phone || '',
        address_line1: location.address_line1 || '',
        address_line2: location.address_line2 || '',
        city: location.city || '',
        state_province: location.state_province || '',
        postal_code: location.postal_code || '',
        country: location.country_name || ''
      };
    });
  });

  const fields = [
    'client_name',
    'website',
    'client_type',
    'is_inactive',
    'notes',
    'tags',
    'location_name',
    'email',
    'phone_number',
    'address_line1',
    'address_line2',
    'city',
    'state_province',
    'postal_code',
    'country'
  ];

  return unparseCSV(exportData, fields);
}

export async function generateCompanyCSVTemplate(): Promise<string> {
  // Create empty template with only headers
  const templateData = [
    {
      client_name: '',
      website: '',
      client_type: '',
      is_inactive: '',
      notes: '',
      tags: '',
      location_name: '',
      email: '',
      phone_number: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: ''
    }
  ];

  const fields = [
    'client_name',
    'website',
    'client_type',
    'is_inactive',
    'notes',
    'tags',
    'location_name',
    'email',
    'phone_number',
    'address_line1',
    'address_line2',
    'city',
    'state_province',
    'postal_code',
    'country'
  ];

  return unparseCSV(templateData, fields);
}

export async function getAllCompanyIds(params: {
  statusFilter?: 'all' | 'active' | 'inactive';
  searchTerm?: string;
  clientTypeFilter?: 'all' | 'company' | 'individual';
  selectedTags?: string[];
} = {}): Promise<string[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot read companies');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const {
    statusFilter = 'all',
    searchTerm,
    clientTypeFilter = 'all',
    selectedTags
  } = params;

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build the base query - same filtering logic as getAllCompaniesPaginated
      let baseQuery = trx('companies as c')
        .where({ 'c.tenant': tenant });

      // Join with locations for search if needed
      if (searchTerm) {
        baseQuery = baseQuery.leftJoin('company_locations as cl', function() {
          this.on('c.company_id', '=', 'cl.company_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        });
      }

      // Apply status filter
      if (statusFilter === 'active') {
        baseQuery = baseQuery.andWhere('c.is_inactive', false);
      } else if (statusFilter === 'inactive') {
        baseQuery = baseQuery.andWhere('c.is_inactive', true);
      }

      // Apply search filter
      if (searchTerm) {
        baseQuery = baseQuery.where(function() {
          this.where('c.company_name', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.phone', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.address_line1', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.address_line2', 'ilike', `%${searchTerm}%`)
              .orWhere('cl.city', 'ilike', `%${searchTerm}%`);
        });
      }

      // Apply client type filter
      if (clientTypeFilter !== 'all') {
        baseQuery = baseQuery.where('c.client_type', clientTypeFilter);
      }

      // Apply tag filter using new tag structure
      if (selectedTags && selectedTags.length > 0) {
        baseQuery = baseQuery.whereIn('c.company_id', function() {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'company')
            .where('tm.tenant', tenant)
            .whereIn('td.tag_text', selectedTags);
        });
      }

      // Get all company IDs
      const companies = await baseQuery.select('c.company_id');
      return companies.map(c => c.company_id);
    });
  } catch (error) {
    console.error('Error fetching all company IDs:', error);
    throw error;
  }
}

export async function checkExistingCompanies(
  companyNames: string[]
): Promise<ICompany[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for company reading
  if (!await hasPermission(currentUser, 'company', 'read')) {
    throw new Error('Permission denied: Cannot read companies');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const existingCompanies = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .select('*')
      .whereIn('company_name', companyNames)
      .andWhere('tenant', tenant);
  });

  return existingCompanies;
}

export interface ImportCompanyResult {
  success: boolean;
  message: string;
  company?: ICompany;
  originalData: Record<string, any>;
}

export async function importCompaniesFromCSV(
  companiesData: Array<Record<string, any>>,
  updateExisting: boolean = false
): Promise<ImportCompanyResult[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permissions for both create and update operations since import can do both
  if (!await hasPermission(currentUser, 'company', 'create')) {
    throw new Error('Permission denied: Cannot create companies');
  }
  
  if (updateExisting && !await hasPermission(currentUser, 'company', 'update')) {
    throw new Error('Permission denied: Cannot update companies');
  }

  const results: ImportCompanyResult[] = [];
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Start a transaction to ensure all operations succeed or fail together
  await withTransaction(db, async (trx: Knex.Transaction) => {
    for (const companyData of companiesData) {
      try {
        if (!companyData.company_name) {
          throw new Error('Company name is required');
        }

        const existingCompany = await trx('companies')
          .where({ company_name: companyData.company_name, tenant })
          .first();

        if (existingCompany && !updateExisting) {
          results.push({
            success: false,
            message: `Company with name ${companyData.company_name} already exists`,
            originalData: companyData
          });
          continue;
        }

        let savedCompany: ICompany;

        if (existingCompany && updateExisting) {
          // Keep the existing tenant when updating
          const { tenant: _, ...safeCompanyData } = companyData; // Remove tenant from spread to prevent override
          const { account_manager_id, ...restOfSafeData } = safeCompanyData;
          const updateData = {
            ...restOfSafeData,
            account_manager_id: account_manager_id === '' ? null : account_manager_id,
            tenant: existingCompany.tenant, // Explicitly set correct tenant
            updated_at: new Date().toISOString()
          };

          [savedCompany] = await trx('companies')
            .where({ company_id: existingCompany.company_id })
            .update(updateData)
            .returning('*');

          results.push({
            success: true,
            message: 'Company updated',
            company: savedCompany,
            originalData: companyData
          });
        } else {
          // Create new company with synchronized website fields
          const properties = companyData.properties ? { ...companyData.properties } : {};
          const url = companyData.url || '';
          
          // Sync website and url fields
          if (properties.website && !url) {
            // If only properties.website exists, use it for url
            companyData.url = properties.website;
          } else if (url && !properties.website) {
            // If only url exists, use it for properties.website
            properties.website = url;
          }
          
          const companyToCreate = {
            company_name: companyData.client_name || companyData.company_name,
            url: companyData.website || companyData.url || '',
            is_inactive: companyData.is_inactive === 'Yes' || companyData.is_inactive === true || false,
            is_tax_exempt: companyData.is_tax_exempt || false,
            client_type: companyData.client_type || 'company',
            tenant: tenant,
            properties: properties,
            account_manager_id: companyData.account_manager_id === '' ? null : companyData.account_manager_id,
            payment_terms: companyData.payment_terms || '',
            billing_cycle: companyData.billing_cycle || 'monthly',
            credit_limit: companyData.credit_limit || 0,
            preferred_payment_method: companyData.preferred_payment_method || '',
            auto_invoice: companyData.auto_invoice || false,
            invoice_delivery_method: companyData.invoice_delivery_method || '',
            region_code: companyData.region_code || null,
            tax_id_number: companyData.tax_id_number || '',
            tax_exemption_certificate: companyData.tax_exemption_certificate || '',
            notes: companyData.notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          [savedCompany] = await trx('companies')
            .insert(companyToCreate)
            .returning('*');

          // Create default location if any location data exists in CSV
          if (companyData.email || companyData.phone_number || companyData.address_line1 || 
              companyData.city || companyData.location_name) {
            try {
              await trx('company_locations').insert({
                location_id: trx.raw('gen_random_uuid()'),
                company_id: savedCompany.company_id,
                tenant: tenant,
                location_name: companyData.location_name || 'Main Office',
                address_line1: companyData.address_line1 || '',
                address_line2: companyData.address_line2 || '',
                city: companyData.city || '',
                state_province: companyData.state_province || '',
                postal_code: companyData.postal_code || '',
                country_code: 'US',
                country_name: companyData.country || 'United States',
                phone: companyData.phone_number || '',
                email: companyData.email || '',
                is_default: true,
                is_billing_address: true,
                is_shipping_address: true,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
            } catch (locationError) {
              console.error('Failed to create location during CSV import:', locationError);
              // Don't fail the company import if location creation fails
            }
          }

          // Handle tags if provided
          if (companyData.tags) {
            try {
              const tagTexts = companyData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
              for (const tagText of tagTexts) {
                await createTag({
                  tag_text: tagText,
                  tagged_id: savedCompany.company_id,
                  tagged_type: 'company',
                  created_by: currentUser.user_id
                });
              }
            } catch (tagError) {
              console.error('Failed to create tags during CSV import:', tagError);
              // Don't fail the company import if tag creation fails
            }
          }

          results.push({
            success: true,
            message: 'Company created',
            company: savedCompany,
            originalData: companyData
          });
        }
      } catch (error) {
        console.error('Error processing company:', companyData, error);
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          originalData: companyData
        });
      }
    }
  });

  return results;
}

export async function uploadCompanyLogo(
  companyId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; logoUrl?: string | null }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, message: 'User not authenticated' };
  }

  const file = formData.get('logo') as File;
  if (!file) {
    return { success: false, message: 'No logo file provided' };
  }

  // Check permission for company updating (logo upload is an update operation)
  if (!await hasPermission(currentUser, 'company', 'update')) {
    return { success: false, message: 'Permission denied: Cannot update company logo' };
  }

  try {
    const result = await uploadEntityImage(
      'company',
      companyId,
      file,
      currentUser.user_id,
      tenant,
      undefined,
      true
    );

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Invalidate cache for relevant paths - be more comprehensive
    revalidatePath(`/client-portal/settings`);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/msp/companies/${companyId}`);
    revalidatePath(`/msp/companies`);
    revalidatePath(`/settings/general`);
    revalidatePath('/'); // Main dashboard that might show company info

    console.log(`[uploadCompanyLogo] Upload process finished successfully for company ${companyId}. Returning URL: ${result.imageUrl}`);
    return { success: true, logoUrl: result.imageUrl };
  } catch (error) {
    console.error('[uploadCompanyLogo] Error during upload process:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload company logo';
    return { success: false, message };
  }
}

export async function deleteCompanyLogo(
  companyId: string
): Promise<{ success: boolean; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, message: 'User not authenticated' };
  }

  // Check permission for company deletion (logo deletion is a delete operation)
  if (!await hasPermission(currentUser, 'company', 'delete')) {
    return { success: false, message: 'Permission denied: Cannot delete company logo' };
  }

  try {
    console.log(`[deleteCompanyLogo] Starting deletion process for company ${companyId}, tenant: ${tenant}`);
    const result = await deleteEntityImage(
      'company',
      companyId,
      currentUser.user_id,
      tenant
    );
    console.log(`[deleteCompanyLogo] deleteEntityImage result:`, result);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Invalidate cache for relevant paths - be more comprehensive
    revalidatePath(`/client-portal/settings`);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/msp/companies/${companyId}`);
    revalidatePath(`/msp/companies`);
    revalidatePath(`/settings/general`);
    revalidatePath('/'); // Main dashboard that might show company info

    console.log(`[deleteCompanyLogo] Deletion process finished successfully for company ${companyId}.`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting company logo:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete company logo';
    return { success: false, message };
  }
}
