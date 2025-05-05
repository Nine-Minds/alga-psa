'use server'

import { ICompany } from 'server/src/interfaces/company.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { createDefaultTaxSettings } from './taxSettingsActions';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getCompanyLogoUrl } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';


export async function getCompanyById(companyId: string): Promise<ICompany | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Fetch company data
  const companyData = await knex('companies')
    .where({ company_id: companyId, tenant })
    .first();

  if (!companyData) {
    return null;
  }

  // Get the company logo URL using the utility function
  const logoUrl = await getCompanyLogoUrl(companyId, tenant);

  return {
    ...companyData,
    logoUrl,
  } as ICompany;
}

export async function updateCompany(companyId: string, updateData: Partial<Omit<ICompany, 'account_manager_full_name'>>): Promise<ICompany> { // Omit joined field from update type
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    console.log('Updating company in database:', companyId, updateData);

    await db.transaction(async (trx) => {
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
        // Exclude properties, url, tax_region, and the new account_manager_id
        if (key !== 'properties' && key !== 'url' && key !== 'tax_region' && key !== 'account_manager_id') {
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

export async function createCompany(company: Omit<ICompany, 'company_id' | 'created_at' | 'updated_at' | 'account_manager_full_name'>): Promise<ICompany> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

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

  const [createdCompany] = await knex<ICompany>('companies')
    .insert({
      ...companyData,
      tenant,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .returning('*');

  if (!createdCompany) {
    throw new Error('Failed to create company');
  }

  // Create default tax settings for the new company
  await createDefaultTaxSettings(createdCompany.company_id);

  return createdCompany;
}

export async function getAllCompanies(includeInactive: boolean = true): Promise<ICompany[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Start building the query
    let baseQuery = db('companies as c')
      .where({ 'c.tenant': tenant });

    if (!includeInactive) {
      baseQuery = baseQuery.andWhere('c.is_inactive', false);
    }

    // Use a subquery approach to get unique companies
    const companiesData = await baseQuery
      .select(
        'c.*',
        db.raw('(SELECT document_id FROM document_associations da WHERE da.entity_id = c.company_id AND da.entity_type = \'company\' AND da.tenant = c.tenant LIMIT 1) as document_id')
      );

    // Fetch file_ids for logos
    const documentIds = companiesData
      .map(c => c.document_id)
      .filter((id): id is string => !!id); // Filter out null/undefined IDs

    let fileIdMap: Record<string, string> = {};
    if (documentIds.length > 0) {
      const fileRecords = await db('documents')
        .select('document_id', 'file_id')
        .whereIn('document_id', documentIds)
        .andWhere({ tenant });
      
      fileIdMap = fileRecords.reduce((acc, record) => {
        if (record.file_id) {
          acc[record.document_id] = record.file_id;
        }
        return acc;
      }, {} as Record<string, string>);
    }

    // Process companies to add logoUrl
    const companiesWithLogos = await Promise.all(companiesData.map(async (companyData) => {
      const logoUrl = await getCompanyLogoUrl(companyData.company_id, tenant);
      
      // Remove the temporary document_id before returning
      const { document_id, ...company } = companyData;
      return {
        ...company,
        properties: company.properties || {},
        logoUrl,
      };
    }));

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
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // First verify the company exists and belongs to this tenant
    const company = await db('companies')
      .where({ company_id: companyId, tenant })
      .first();
    
    if (!company) {
      return {
        success: false,
        message: 'Company not found'
      };
    }

    console.log('Checking dependencies for company:', companyId, 'tenant:', tenant);

    // Check for dependencies
    const dependencies = [];
    const counts: Record<string, number> = {};

    // Check for contacts
    const contactCount = await db('contacts')
      .where({ company_id: companyId, tenant })
      .count('contact_name_id as count')
      .first();
    console.log('Contact count result:', contactCount);
    if (contactCount && Number(contactCount.count) > 0) {
      dependencies.push('contact');
      counts['contact'] = Number(contactCount.count);
    }

    // Check for active tickets
    const ticketCount = await db('tickets')
      .where({ company_id: companyId, tenant, is_closed: false })
      .count('ticket_id as count')
      .first();
    console.log('Ticket count result:', ticketCount);
    if (ticketCount && Number(ticketCount.count) > 0) {
      dependencies.push('ticket');
      counts['ticket'] = Number(ticketCount.count);
    }

    // Check for projects
    const projectCount = await db('projects')
      .where({ company_id: companyId, tenant })
      .count('project_id as count')
      .first();
    console.log('Project count result:', projectCount);
    if (projectCount && Number(projectCount.count) > 0) {
      dependencies.push('project');
      counts['project'] = Number(projectCount.count);
    }

    // Check for documents using document_associations table
    const documentCount = await db('document_associations')
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
    const invoiceCount = await db('invoices')
      .where({ company_id: companyId, tenant })
      .count('invoice_id as count')
      .first();
    console.log('Invoice count result:', invoiceCount);
    if (invoiceCount && Number(invoiceCount.count) > 0) {
      dependencies.push('invoice');
      counts['invoice'] = Number(invoiceCount.count);
    }

    // Check for interactions
    const interactionCount = await db('interactions')
      .where({ company_id: companyId, tenant })
      .count('interaction_id as count')
      .first();
    console.log('Interaction count result:', interactionCount);
    if (interactionCount && Number(interactionCount.count) > 0) {
      dependencies.push('interaction');
      counts['interaction'] = Number(interactionCount.count);
    }

    // Check for schedules
    const scheduleCount = await db('schedules')
      .where({ company_id: companyId, tenant })
      .count('schedule_id as count')
      .first();
    console.log('Schedule count result:', scheduleCount);
    if (scheduleCount && Number(scheduleCount.count) > 0) {
      dependencies.push('schedule');
      counts['schedule'] = Number(scheduleCount.count);
    }

    // Check for locations
    const locationCount = await db('company_locations')
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
    const usageCount = await db('usage_tracking')
      .where({ company_id: companyId, tenant })
      .count('usage_id as count')
      .first();
    console.log('Usage count result:', usageCount);
    if (usageCount && Number(usageCount.count) > 0) {
      dependencies.push('service_usage');
      counts['service_usage'] = Number(usageCount.count);
    }

    // Check for billing plans
    const billingPlanCount = await db('company_billing_plans')
      .where({ company_id: companyId, tenant })
      .count('company_billing_plan_id as count')
      .first();
    console.log('Billing plan count result:', billingPlanCount);
    if (billingPlanCount && Number(billingPlanCount.count) > 0) {
      dependencies.push('billing_plan');
      counts['billing_plan'] = Number(billingPlanCount.count);
    }

    // Check for bucket usage
    const bucketUsageCount = await db('bucket_usage')
      .where({ company_id: companyId, tenant })
      .count('usage_id as count')
      .first();
    console.log('Bucket usage count result:', bucketUsageCount);
    if (bucketUsageCount && Number(bucketUsageCount.count) > 0) {
      dependencies.push('bucket_usage');
      counts['bucket_usage'] = Number(bucketUsageCount.count);
    }

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
        'schedule': 'schedules',
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
    const result = await db.transaction(async (trx) => {
      // Delete associated tags first
      await trx('tags')
        .where({ 
          tagged_id: companyId, 
          tagged_type: 'company',
          tenant
        })
        .delete();

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
  const fields = [
    'company_name',
    'phone_no',
    'email',
    'url',
    'address',
    'client_type',
    'is_inactive',
    'is_tax_exempt',
    'tax_id_number',
    'payment_terms',
    'billing_cycle',
    'credit_limit',
    'preferred_payment_method',
    'auto_invoice',
    'invoice_delivery_method',
    'region_code', // Changed from tax_region
    'notes' 
  ];

  return unparseCSV(companies, fields);
}

export async function checkExistingCompanies(
  companyNames: string[]
): Promise<ICompany[]> {
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const existingCompanies = await db('companies')
    .select('*')
    .whereIn('company_name', companyNames)
    .andWhere('tenant', tenant);

  return existingCompanies;
}

export interface ImportCompanyResult {
  success: boolean;
  message: string;
  company?: ICompany;
  originalData: Record<string, any>;
}

export async function importCompaniesFromCSV(
  companiesData: Array<Partial<Omit<ICompany, 'account_manager_full_name'>>>,
  updateExisting: boolean = false
): Promise<ImportCompanyResult[]> {
  const results: ImportCompanyResult[] = [];
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Start a transaction to ensure all operations succeed or fail together
  await db.transaction(async (trx) => {
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
            company_name: companyData.company_name,
            phone_no: companyData.phone_no || '',
            email: companyData.email || '',
            url: companyData.url || '',
            address: companyData.address || '',
            is_inactive: companyData.is_inactive || false,
            is_tax_exempt: companyData.is_tax_exempt || false,
            client_type: companyData.client_type || 'company',
            tenant: tenant,
            properties: properties,
            account_manager_id: companyData.account_manager_id === '' ? null : companyData.account_manager_id,
            payment_terms: companyData.payment_terms || '',
            billing_cycle: companyData.billing_cycle || '',
            credit_limit: companyData.credit_limit || 0,
            preferred_payment_method: companyData.preferred_payment_method || '',
            auto_invoice: companyData.auto_invoice || false,
            invoice_delivery_method: companyData.invoice_delivery_method || '',
            region_code: companyData.region_code || null, // Changed tax_region to region_code
            tax_id_number: companyData.tax_id_number || '',
            tax_exemption_certificate: companyData.tax_exemption_certificate || '',
            notes: companyData.notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          [savedCompany] = await trx('companies')
            .insert(companyToCreate)
            .returning('*');

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

  // TODO: Add permission check here if needed, verifying user can modify this companyId

  try {
    const result = await uploadEntityImage(
      'company',
      companyId,
      file,
      currentUser.user_id,
      tenant
    );

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/client-portal/settings`);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/settings/general`); // Also invalidate general settings where company logo might appear

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

  // TODO: Add permission check here if needed

  try {
    const result = await deleteEntityImage(
      'company',
      companyId,
      currentUser.user_id,
      tenant
    );

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/client-portal/settings`);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/settings/general`); // Also invalidate general settings

    console.log(`[deleteCompanyLogo] Deletion process finished successfully for company ${companyId}.`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting company logo:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete company logo';
    return { success: false, message };
  }
}
