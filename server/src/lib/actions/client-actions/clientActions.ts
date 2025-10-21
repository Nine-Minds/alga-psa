'use server'

import { IClient, IClientWithLocation } from 'server/src/interfaces/client.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { createDefaultTaxSettings } from '../taxSettingsActions';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getClientLogoUrl, getClientLogoUrlsBatch } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { deleteEntityTags } from '../../utils/tagCleanup';
import { createTag } from '../tagActions';
import { ClientModel } from '@alga-psa/shared/models/clientModel';

export async function getClientById(clientId: string): Promise<IClientWithLocation | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (in MSP, clients are managed via 'client' resource)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Fetch client data with account manager info and location data
  const clientData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients as c')
      .leftJoin('users as u', function() {
        this.on('c.account_manager_id', '=', 'u.user_id')
            .andOn('c.tenant', '=', 'u.tenant');
      })
      .leftJoin('client_locations as cl', function() {
        this.on('c.client_id', '=', 'cl.client_id')
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
      .where({ 'c.client_id': clientId, 'c.tenant': tenant })
      .first();
  });

  if (!clientData) {
    return null;
  }

  // Get the client logo URL using the utility function
  const logoUrl = await getClientLogoUrl(clientId, tenant);

  return {
    ...clientData,
    logoUrl,
  } as IClientWithLocation;
}

export async function updateClient(clientId: string, updateData: Partial<Omit<IClient, 'account_manager_full_name'>>): Promise<IClient> { // Omit joined field from update type
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client updating
  if (!await hasPermission(currentUser, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update clients');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    console.log('Updating client in database:', clientId, updateData);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build update object with explicit null handling
      const updateObject: any = {
        updated_at: new Date().toISOString()
      };

      // First, get the current client data to properly merge properties
      const currentClient = await trx<IClient>('clients')
        .where({ client_id: clientId, tenant })
        .first();
      
      if (!currentClient) {
        throw new Error('Client not found');
      }

      // Handle properties separately
      if (updateData.properties) {
        const currentProperties = currentClient.properties || {};
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
            ...(currentClient.properties || {}),
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
        // Exclude properties, url, tax_region, account_manager_id, logoUrl (computed field), location fields, and partition keys (tenant, client_id)
        const excludedFields = ['properties', 'url', 'tax_region', 'account_manager_id', 'logoUrl', 'tenant', 'client_id', 'phone', 'email', 'address', 'location_email', 'location_phone', 'location_address', 'address_line1', 'address_line2', 'city', 'state_province', 'postal_code', 'country_name'];
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

      console.log('Final updateObject being sent to database:', JSON.stringify(updateObject, null, 2));
      console.log('Update contains is_inactive:', 'is_inactive' in updateObject, 'value:', updateObject.is_inactive);

      await trx('clients')
        .where({ client_id: clientId, tenant })
        .update(updateObject);

      // If the client is being set to inactive, update all associated contacts
      if (updateData.is_inactive === true) {
        await trx('contacts')
          .where({ client_id: clientId, tenant })
          .update({ is_inactive: true });
      }
    });

    // Email suffix functionality removed for security

    // Fetch and return the updated client data including logoUrl
    const updatedClientWithLogo = await getClientById(clientId);
    if (!updatedClientWithLogo) {
        throw new Error('Failed to fetch updated client data');
    }

    console.log('Updated client data:', updatedClientWithLogo);
    return updatedClientWithLogo;
  } catch (error) {
    console.error('Error updating client:', error);
    throw new Error('Failed to update client');
  }
}

export async function createClient(client: Omit<IClient, 'client_id' | 'created_at' | 'updated_at' | 'account_manager_full_name'>): Promise<{ success: true; data: IClient } | { success: false; error: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client creation
  if (!await hasPermission(currentUser, 'client', 'create')) {
    throw new Error('Permission denied: Cannot create clients');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Ensure website field is synchronized between properties.website and url
    const clientData = { ...client };
    
    // If properties.website exists but url doesn't, sync url from properties.website
    if (clientData.properties?.website && !clientData.url) {
      clientData.url = clientData.properties.website;
    }
    
    // If url exists but properties.website doesn't, sync properties.website from url
    if (clientData.url && (!clientData.properties || !clientData.properties.website)) {
      if (!clientData.properties) {
        clientData.properties = {};
      }
      clientData.properties.website = clientData.url;
    }

    const createdClient = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [created] = await trx<IClient>('clients')
        .insert({
          ...clientData,
          tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');
        
      return created;
    });

    if (!createdClient) {
      throw new Error('Failed to create client');
    }

    // Create default tax settings for the new client
    await createDefaultTaxSettings(createdClient.client_id);

    // Email suffix functionality removed for security

    return { success: true, data: createdClient };
  } catch (error: any) {
    console.error('Error creating client:', error);
    
    // Handle specific database constraint violations
    if (error.code === '23505') { // PostgreSQL unique constraint violation
      if (error.constraint && error.constraint.includes('clients_tenant_client_name_unique')) {
        return { success: false, error: `A client with the name "${client.client_name}" already exists. Please choose a different name.` };
      } else {
        return { success: false, error: 'A client with these details already exists. Please check the client name.' };
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
    throw new Error('Failed to create client. Please try again.');
  }
}

// Pagination interface
export interface ClientPaginationParams {
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  searchTerm?: string;
  clientTypeFilter?: 'all' | 'company' | 'individual';
  loadLogos?: boolean; // Option to load logos or not
  selectedTags?: string[]; // Filter by tags
  /**
   * Optional status filter. Overrides includeInactive if provided.
   *  - 'active'   -> only active clients
   *  - 'inactive' -> only inactive clients
   *  - 'all'      -> include both active and inactive
   */
  statusFilter?: 'all' | 'active' | 'inactive';
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface PaginatedClientsResponse {
  clients: IClient[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getAllClientsPaginated(params: ClientPaginationParams = {}): Promise<PaginatedClientsResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (in MSP, clients are managed via 'client' resource)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const {
    page = 1,
    pageSize = 10,
    includeInactive = true,
    searchTerm,
    clientTypeFilter = 'all',
    loadLogos = true,
    statusFilter,
    selectedTags,
    sortBy = 'client_name',
    sortDirection = 'asc'
  } = params;

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const offset = (page - 1) * pageSize;

    // Use a transaction to get paginated client data
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build the base query with client_locations join
      let baseQuery = trx('clients as c')
        .leftJoin('users as u', function() {
          this.on('c.account_manager_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
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
          this.where('c.client_name', 'ilike', `%${searchTerm}%`)
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
        baseQuery = baseQuery.whereIn('c.client_id', function() {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'client')
            .where('tm.tenant', tenant)
            .whereIn('td.tag_text', selectedTags);
        });
      }

      // Get total count
      const countResult = await baseQuery.clone().count('* as count').first();
      const totalCount = parseInt(countResult?.count as string || '0', 10);

      // Get paginated clients with location data and default flag
      let clientsQuery = baseQuery
        .leftJoin('tenant_companies as tc', function() {
          this.on('c.client_id', '=', 'tc.client_id')
              .andOn('c.tenant', '=', 'tc.tenant');
        })
        .select(
          'c.*',
          'tc.is_default',
          trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`),
          'cl.phone as location_phone',
          'cl.email as location_email',
          'cl.address_line1',
          'cl.address_line2',
          'cl.city',
          'cl.state_province',
          'cl.postal_code',
          'cl.country_name'
        );

      // Apply sorting based on the column name
      if (sortBy) {
        // Map frontend column names to database column names
        const sortColumnMap: Record<string, string> = {
          'client_name': 'c.client_name',
          'client_type': 'c.client_type',
          'phone_no': 'cl.phone',
          'address': 'cl.address_line1',
          'account_manager_full_name': 'account_manager_full_name',
          'url': 'c.url'
        };
        
        const sortColumn = sortColumnMap[sortBy] || 'c.client_name';
        // Validate sortDirection to prevent SQL injection
        const validSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';
        
        // Use case-insensitive sorting with LOWER() function
        // This is compatible with both PostgreSQL and Citus distributed tables
        const textColumns = ['client_name', 'client_type', 'address', 'account_manager_full_name', 'url'];
        if (textColumns.includes(sortBy)) {
          // Using LOWER() is Citus-compatible and provides case-insensitive sorting
          clientsQuery = clientsQuery.orderByRaw(`LOWER(${sortColumn}) ${validSortDirection}`);
        } else {
          // Non-text columns use standard ordering
          clientsQuery = clientsQuery.orderBy(sortColumn, validSortDirection);
        }
      } else {
        // Default case-insensitive sorting by client name
        clientsQuery = clientsQuery.orderByRaw('LOWER(c.client_name) asc');
      }

      const clients = await clientsQuery
        .limit(pageSize)
        .offset(offset);

      return { clients, totalCount };
    });

    // Process clients to add logoUrl if requested
    let clientsWithLogos = result.clients;
    
    if (loadLogos && clientsWithLogos.length > 0) {
      const clientIds = clientsWithLogos.map(c => c.client_id);
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      
      clientsWithLogos = clientsWithLogos.map((client) => ({
        ...client,
        properties: client.properties || {},
        logoUrl: logoUrlsMap.get(client.client_id) || null,
      }));
    } else {
      // If not loading logos, ensure logoUrl is null
      clientsWithLogos = clientsWithLogos.map((client) => ({
        ...client,
        properties: client.properties || {},
        logoUrl: null,
      }));
    }

    return {
      clients: clientsWithLogos as IClient[],
      totalCount: result.totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(result.totalCount / pageSize)
    };
  } catch (error) {
    console.error('Error fetching paginated clients:', error);
    throw error;
  }
}

export async function getAllClients(includeInactive: boolean = true): Promise<IClient[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (in MSP, clients are managed via 'client' resource)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    console.log('[getAllClients] Fetching clients for tenant:', tenant, 'includeInactive:', includeInactive);

    // Start with basic clients query and fallback gracefully
    let clients: any[] = [];
    try {
      clients = await db('clients')
        .select('*')
        .where('tenant', tenant);

      console.log('[getAllClients] Found', clients.length, 'clients');
    } catch (dbErr: any) {
      console.error('[getAllClients] Database error:', dbErr);

      if (dbErr.message && (
        dbErr.message.includes('relation') ||
        dbErr.message.includes('does not exist') ||
        dbErr.message.includes('table')
      )) {
        // Try fallback to companies table for company→client migration
        console.log('[getAllClients] Clients table not found, trying companies table fallback...');
        try {
          const companies = await db('companies')
            .select('*')
            .where('tenant', tenant);

          console.log('[getAllClients] Found', companies.length, 'companies, mapping to client structure');

          // Map companies to client structure
          clients = companies.map(company => ({
            ...company,
            client_id: company.company_id || company.id,
            client_name: company.company_name || company.name,
          }));
        } catch (companiesErr) {
          console.error('[getAllClients] Companies table also failed:', companiesErr);
          throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
        }
      } else {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    // Filter inactive clients if requested
    if (!includeInactive) {
      clients = clients.filter(client => !client.is_inactive);
    }

    console.log('[getAllClients] Returning', clients.length, 'clients (filtered for inactive:', !includeInactive, ')');
    return clients as IClient[];
  } catch (error: any) {
    console.error('[getAllClients] Error fetching all clients:', error);

    // Handle known error types
    if (error instanceof Error) {
      const message = error.message;

      // If it's already one of our formatted errors, rethrow it
      if (message.includes('SYSTEM_ERROR:')) {
        throw error;
      }

      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
  }
}

export async function deleteClient(clientId: string): Promise<{ 
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

  // Check permission for client deletion
  if (!await hasPermission(currentUser, 'client', 'delete')) {
    throw new Error('Permission denied: Cannot delete clients');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // First verify the client exists and belongs to this tenant
    const client = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('clients')
        .where({ client_id: clientId, tenant })
        .first();
    });
    
    if (!client) {
      return {
        success: false,
        message: 'Client not found'
      };
    }

    // Check if this is the tenant's default client
    const isDefaultClient = await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantClient = await trx('tenant_companies')
        .where({ 
          client_id: clientId, 
          tenant,
          is_default: true 
        })
        .first();
      return !!tenantClient;
    });
    
    if (isDefaultClient) {
      return {
        success: false,
        code: 'DEFAULT_COMPANY_PROTECTED',
        message: 'Cannot delete the default client. Please set another client as default in General Settings first.'
      };
    }

    console.log('Checking dependencies for client:', clientId, 'tenant:', tenant);

    // Check for dependencies
    const dependencies: string[] = [];
    const counts: Record<string, number> = {};

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check for contacts
      const contactCount = await trx('contacts')
        .where({ client_id: clientId, tenant })
        .count('contact_name_id as count')
        .first();
      console.log('Contact count result:', contactCount);
      if (contactCount && Number(contactCount.count) > 0) {
        dependencies.push('contact');
        counts['contact'] = Number(contactCount.count);
      }

      // Check for active tickets
      const ticketCount = await trx('tickets')
        .where({ client_id: clientId, tenant, is_closed: false })
        .count('ticket_id as count')
        .first();
      console.log('Ticket count result:', ticketCount);
      if (ticketCount && Number(ticketCount.count) > 0) {
        dependencies.push('ticket');
        counts['ticket'] = Number(ticketCount.count);
      }

      // Check for projects
      const projectCount = await trx('projects')
        .where({ client_id: clientId, tenant })
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
          entity_id: clientId, 
          entity_type: 'client', 
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
        .where({ client_id: clientId, tenant })
        .count('invoice_id as count')
        .first();
      console.log('Invoice count result:', invoiceCount);
      if (invoiceCount && Number(invoiceCount.count) > 0) {
        dependencies.push('invoice');
        counts['invoice'] = Number(invoiceCount.count);
      }

      // Check for interactions
      const interactionCount = await trx('interactions')
        .where({ client_id: clientId, tenant })
        .count('interaction_id as count')
        .first();
      console.log('Interaction count result:', interactionCount);
      if (interactionCount && Number(interactionCount.count) > 0) {
        dependencies.push('interaction');
        counts['interaction'] = Number(interactionCount.count);
      }

      // Check for locations
      const locationCount = await trx('client_locations')
        .join('clients', 'clients.client_id', 'client_locations.client_id')
        .where({ 
          'client_locations.client_id': clientId,
          'clients.tenant': tenant 
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
        .where({ client_id: clientId, tenant })
        .count('usage_id as count')
        .first();
      console.log('Usage count result:', usageCount);
      if (usageCount && Number(usageCount.count) > 0) {
        dependencies.push('service_usage');
        counts['service_usage'] = Number(usageCount.count);
      }

      // Check for contract lines
      const contractLineCount = await trx('client_contract_lines')
        .where({ client_id: clientId, tenant })
        .count('client_contract_line_id as count')
        .first();
      console.log('Contract Line count result:', contractLineCount);
      if (contractLineCount && Number(contractLineCount.count) > 0) {
        dependencies.push('contract_line');
        counts['contract_line'] = Number(contractLineCount.count);
      }

      // Check for bucket usage
      const bucketUsageCount = await trx('bucket_usage')
        .where({ client_id: clientId, tenant })
        .count('usage_id as count')
        .first();
      console.log('Bucket usage count result:', bucketUsageCount);
      if (bucketUsageCount && Number(bucketUsageCount.count) > 0) {
        dependencies.push('bucket_usage');
        counts['bucket_usage'] = Number(bucketUsageCount.count);
      }
    });

    // We're automatically deleting tax rates and settings when deleting the client,
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
        'contract_line': 'contract lines'
      };

      return {
        success: false,
        code: 'COMPANY_HAS_DEPENDENCIES',
        message: 'Client has associated records and cannot be deleted',
        dependencies: dependencies.map((dep: string): string => readableTypes[dep] || dep),
        counts
      };
    }

    // If no dependencies, proceed with simple deletion (only the client record)
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Only delete the client record itself - no associated data
      const deleted = await trx('clients')
        .where({ client_id: clientId, tenant })
        .delete();

      if (!deleted || deleted === 0) {
        throw new Error('Client record not found or could not be deleted');
      }

      return { success: true };
    });

    return result;
  } catch (error) {
    console.error('Error deleting client:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete client'
    };
  }
}


export async function exportClientsToCSV(clients: IClient[]): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (export is a read operation)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot export clients');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const exportData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Fetch location data for all clients
    const clientIds = clients.map(c => c.client_id);
    const locations = await trx('client_locations')
      .whereIn('client_id', clientIds)
      .andWhere('tenant', tenant)
      .andWhere('is_default', true);

    // Create a map of client_id to location
    const locationMap = new Map();
    locations.forEach(loc => {
      locationMap.set(loc.client_id, loc);
    });

    // Fetch tags for all clients
    const { findTagsByEntityIds } = await import('../tagActions');
    const tags = await findTagsByEntityIds(clientIds, 'client');
    
    // Create a map of client_id to tags
    const tagMap = new Map<string, string[]>();
    tags.forEach(tag => {
      if (!tagMap.has(tag.tagged_id)) {
        tagMap.set(tag.tagged_id, []);
      }
      tagMap.get(tag.tagged_id)!.push(tag.tag_text);
    });

    // Prepare export data with location fields
    return clients.map(client => {
      const location = locationMap.get(client.client_id) || {};
      const clientTags = tagMap.get(client.client_id) || [];
      const tagNames = clientTags.join(', ');
      
      return {
        client_name: client.client_name,
        website: client.url || '',
        client_type: client.client_type || 'company',
        is_inactive: client.is_inactive ? 'true' : 'false',
        notes: client.notes || '',
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

export async function generateClientCSVTemplate(): Promise<string> {
  // Create template with Alice in Wonderland themed sample data
  const templateData = [
    {
      client_name: 'Mad Hatter Tea Client',
      website: 'https://madhatterteaclient.com',
      client_type: 'company',
      is_inactive: 'false',
      notes: 'Specializes in unbirthday party supplies and premium tea blends',
      tags: 'Tea, Party Planning, Whimsical',
      location_name: 'The Tea Party Table',
      email: 'hatter@teaparty.wonderland',
      phone_number: '+1-555-TEA-TIME',
      address_line1: '6 Impossible Things Lane',
      address_line2: 'Before Breakfast Suite',
      city: 'Wonderland',
      state_province: 'Fantasy',
      postal_code: 'WL001',
      country: 'Wonderland'
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

export async function getAllClientIds(params: {
  statusFilter?: 'all' | 'active' | 'inactive';
  searchTerm?: string;
  clientTypeFilter?: 'all' | 'company' | 'individual';
  selectedTags?: string[];
} = {}): Promise<string[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (in MSP, clients are managed via 'client' resource)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
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
      // Build the base query - same filtering logic as getAllClientsPaginated
      let baseQuery = trx('clients as c')
        .where({ 'c.tenant': tenant });

      // Join with locations for search if needed
      if (searchTerm) {
        baseQuery = baseQuery.leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
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
          this.where('c.client_name', 'ilike', `%${searchTerm}%`)
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
        baseQuery = baseQuery.whereIn('c.client_id', function() {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'client')
            .where('tm.tenant', tenant)
            .whereIn('td.tag_text', selectedTags);
        });
      }

      // Get all client IDs
      const clients = await baseQuery.select('c.client_id');
      return clients.map(c => c.client_id);
    });
  } catch (error) {
    console.error('Error fetching all client IDs:', error);
    throw error;
  }
}

export async function checkExistingClients(
  clientNames: string[]
): Promise<IClient[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for client reading (in MSP, clients are managed via 'client' resource)
  if (!await hasPermission(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const existingClients = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .select('*')
      .whereIn('client_name', clientNames)
      .andWhere('tenant', tenant);
  });

  return existingClients;
}

export interface ImportClientResult {
  success: boolean;
  message: string;
  client?: IClient;
  originalData: Record<string, any>;
}

export async function importClientsFromCSV(
  clientsData: Array<Record<string, any>>,
  updateExisting: boolean = false
): Promise<ImportClientResult[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permissions for both create and update operations since import can do both
  if (!await hasPermission(currentUser, 'client', 'create')) {
    throw new Error('Permission denied: Cannot create clients');
  }
  
  if (updateExisting && !await hasPermission(currentUser, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update clients');
  }

  const results: ImportClientResult[] = [];
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Start a transaction to ensure all operations succeed or fail together
  await withTransaction(db, async (trx: Knex.Transaction) => {
    for (const clientData of clientsData) {
      try {
        if (!clientData.client_name) {
          throw new Error('Client name is required');
        }

        const existingClient = await trx('clients')
          .where({ client_name: clientData.client_name, tenant })
          .first();

        if (existingClient && !updateExisting) {
          results.push({
            success: false,
            message: `Client with name ${clientData.client_name} already exists`,
            originalData: clientData
          });
          continue;
        }

        let savedClient: IClient;

        if (existingClient && updateExisting) {
          // Keep the existing tenant when updating
          const { tenant: _, ...safeClientData } = clientData; // Remove tenant from spread to prevent override
          const { account_manager_id, ...restOfSafeData } = safeClientData;
          const updateData = {
            ...restOfSafeData,
            account_manager_id: account_manager_id === '' ? null : account_manager_id,
            tenant: existingClient.tenant, // Explicitly set correct tenant
            updated_at: new Date().toISOString()
          };

          [savedClient] = await trx('clients')
            .where({ client_id: existingClient.client_id })
            .update(updateData)
            .returning('*');

          results.push({
            success: true,
            message: 'Client updated',
            client: savedClient,
            originalData: clientData
          });
        } else {
          // Create new client with synchronized website fields
          const properties = clientData.properties ? { ...clientData.properties } : {};
          const url = clientData.url || '';
          
          // Sync website and url fields
          if (properties.website && !url) {
            // If only properties.website exists, use it for url
            clientData.url = properties.website;
          } else if (url && !properties.website) {
            // If only url exists, use it for properties.website
            properties.website = url;
          }
          
          const clientToCreate = {
            client_name: clientData.client_name || clientData.client_name,
            url: clientData.website || clientData.url || '',
            is_inactive: clientData.is_inactive === 'Yes' || clientData.is_inactive === true || false,
            is_tax_exempt: clientData.is_tax_exempt || false,
            client_type: clientData.client_type || 'company',
            tenant: tenant,
            properties: properties,
            account_manager_id: clientData.account_manager_id === '' ? null : clientData.account_manager_id,
            payment_terms: clientData.payment_terms || '',
            billing_cycle: clientData.billing_cycle || 'monthly',
            credit_limit: clientData.credit_limit || 0,
            preferred_payment_method: clientData.preferred_payment_method || '',
            auto_invoice: clientData.auto_invoice || false,
            invoice_delivery_method: clientData.invoice_delivery_method || '',
            region_code: clientData.region_code || null,
            tax_id_number: clientData.tax_id_number || '',
            tax_exemption_certificate: clientData.tax_exemption_certificate || '',
            notes: clientData.notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          [savedClient] = await trx('clients')
            .insert(clientToCreate)
            .returning('*');

          // Create default location if any location data exists in CSV
          if (clientData.email || clientData.phone_number || clientData.address_line1 || 
              clientData.city || clientData.location_name) {
            try {
              await trx('client_locations').insert({
                location_id: trx.raw('gen_random_uuid()'),
                client_id: savedClient.client_id,
                tenant: tenant,
                location_name: clientData.location_name || 'Main Office',
                address_line1: clientData.address_line1 || '',
                address_line2: clientData.address_line2 || '',
                city: clientData.city || '',
                state_province: clientData.state_province || '',
                postal_code: clientData.postal_code || '',
                country_code: 'US',
                country_name: clientData.country || 'United States',
                phone: clientData.phone_number || '',
                email: clientData.email || '',
                is_default: true,
                is_billing_address: true,
                is_shipping_address: true,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
            } catch (locationError) {
              console.error('Failed to create location during CSV import:', locationError);
              // Don't fail the client import if location creation fails
            }
          }

          // Handle tags if provided
          if (clientData.tags) {
            try {
              const tagTexts = clientData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
              for (const tagText of tagTexts) {
                await createTag({
                  tag_text: tagText,
                  tagged_id: savedClient.client_id,
                  tagged_type: 'client',
                  created_by: currentUser.user_id
                });
              }
            } catch (tagError) {
              console.error('Failed to create tags during CSV import:', tagError);
              // Don't fail the client import if tag creation fails
            }
          }

          results.push({
            success: true,
            message: 'Client created',
            client: savedClient,
            originalData: clientData
          });
        }
      } catch (error) {
        console.error('Error processing client:', clientData, error);
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          originalData: clientData
        });
      }
    }
  });

  return results;
}

export async function uploadClientLogo(
  clientId: string,
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

  // Check permission for client updating (logo upload is an update operation)
  if (!await hasPermission(currentUser, 'client', 'update')) {
    return { success: false, message: 'Permission denied: Cannot update client logo' };
  }

  try {
    const result = await uploadEntityImage(
      'client',
      clientId,
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
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/clients`);
    revalidatePath(`/settings/general`);
    revalidatePath('/'); // Main dashboard that might show client info

    console.log(`[uploadClientLogo] Upload process finished successfully for client ${clientId}. Returning URL: ${result.imageUrl}`);
    return { success: true, logoUrl: result.imageUrl };
  } catch (error) {
    console.error('[uploadClientLogo] Error during upload process:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload client logo';
    return { success: false, message };
  }
}

export async function deleteClientLogo(
  clientId: string
): Promise<{ success: boolean; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, message: 'User not authenticated' };
  }

  // Check permission for client deletion (logo deletion is a delete operation)
  if (!await hasPermission(currentUser, 'client', 'delete')) {
    return { success: false, message: 'Permission denied: Cannot delete client logo' };
  }

  try {
    console.log(`[deleteClientLogo] Starting deletion process for client ${clientId}, tenant: ${tenant}`);
    const result = await deleteEntityImage(
      'client',
      clientId,
      currentUser.user_id,
      tenant
    );
    console.log(`[deleteClientLogo] deleteEntityImage result:`, result);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Invalidate cache for relevant paths - be more comprehensive
    revalidatePath(`/client-portal/settings`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/clients`);
    revalidatePath(`/settings/general`);
    revalidatePath('/'); // Main dashboard that might show client info

    console.log(`[deleteClientLogo] Deletion process finished successfully for client ${clientId}.`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting client logo:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete client logo';
    return { success: false, message };
  }
}
