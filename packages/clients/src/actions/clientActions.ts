'use server'

import type { IClient, IClientWithLocation } from '@alga-psa/types';
import { createTenantKnex } from 'server/src/lib/db';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getClientLogoUrl, getClientLogoUrlsBatch } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { deleteEntityTags } from 'server/src/lib/utils/tagCleanup';
import { createTag } from 'server/src/lib/actions/tagActions';
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
    throw new Error('Permission denied: Cannot update clients. Please contact your administrator if you need additional access.');
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

export interface BillingCycleDateRange {
  from?: string;
  to?: string;
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
          'url': 'c.url',
          'created_at': 'c.created_at'
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
          // Non-text columns use standard ordering (including created_at which is a timestamp)
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

export async function getClientsWithBillingCycleRangePaginated(
  params: ClientPaginationParams & { dateRange?: BillingCycleDateRange }
): Promise<PaginatedClientsResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

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
    sortDirection = 'asc',
    dateRange
  } = params;

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const offset = (page - 1) * pageSize;

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
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

      if (dateRange?.from || dateRange?.to) {
        baseQuery = baseQuery.whereIn('c.client_id', function() {
          this.select('cbc.client_id')
            .from('client_billing_cycles as cbc')
            .where('cbc.tenant', tenant);

          if (dateRange?.from) {
            const rangeFrom = dateRange.from;
            this.andWhere(function() {
              this.whereNull('cbc.period_end_date')
                .orWhereRaw('cbc.period_end_date >= ?', [rangeFrom]);
            });
          }

          if (dateRange?.to) {
            this.andWhere('cbc.period_start_date', '<=', dateRange.to);
          }
        });
      }

      const countResult = await baseQuery.clone().countDistinct('c.client_id as count').first();
      const totalCount = parseInt(countResult?.count as string || '0', 10);

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

      if (sortBy) {
        const sortColumnMap: Record<string, string> = {
          'client_name': 'c.client_name',
          'client_type': 'c.client_type',
          'phone_no': 'cl.phone',
          'address': 'cl.address_line1',
          'account_manager_full_name': 'account_manager_full_name',
          'url': 'c.url',
          'created_at': 'c.created_at'
        };

        const sortColumn = sortColumnMap[sortBy] || 'c.client_name';
        const validSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

        const textColumns = ['client_name', 'client_type', 'address', 'account_manager_full_name', 'url'];
        if (textColumns.includes(sortBy)) {
          clientsQuery = clientsQuery.orderByRaw(`LOWER(${sortColumn}) ${validSortDirection}`);
        } else {
          clientsQuery = clientsQuery.orderBy(sortColumn, validSortDirection);
        }
      } else {
        clientsQuery = clientsQuery.orderByRaw('LOWER(c.client_name) asc');
      }

      const clients = await clientsQuery
        .limit(pageSize)
        .offset(offset);

      return { clients, totalCount };
    });

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
    console.error('Error fetching paginated clients with billing cycles:', error);
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

  const clients = await withTransaction(db, async (trx) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  });

  if (clients.length === 0) {
    return [];
  }

  const clientIds = clients.map((client: any) => client.client_id);
  const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);

  const clientsWithLogos = clients.map((client: any) => ({
    ...client,
    properties: client.properties || {},
    logoUrl: logoUrlsMap.get(client.client_id) || null,
  }));

  return clientsWithLogos as IClient[];
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

    // Check for dependencies within a single transaction
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

      // Check for open tickets - join with statuses to check is_closed flag
      const ticketCount = await trx('tickets')
        .leftJoin('statuses', function() {
          this.on('tickets.status_id', '=', 'statuses.status_id')
              .andOn('tickets.tenant', '=', 'statuses.tenant');
        })
        .where({ 'tickets.client_id': clientId, 'tickets.tenant': tenant })
        .andWhere(function() {
          this.where('statuses.is_closed', false).orWhereNull('statuses.is_closed');
        })
        .count('tickets.ticket_id as count')
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

      // Check for assets/devices
      const assetCount = await trx('assets')
        .where({ client_id: clientId, tenant })
        .count('asset_id as count')
        .first();
      console.log('Asset count result:', assetCount);
      if (assetCount && Number(assetCount.count) > 0) {
        dependencies.push('asset');
        counts['asset'] = Number(assetCount.count);
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

    // Note: Locations/addresses and tax settings will be deleted automatically with the client

    // If there are dependencies, return error with details
    if (dependencies.length > 0) {
      const readableTypes: Record<string, string> = {
        'contact': 'contacts',
        'ticket': 'tickets',
        'project': 'projects',
        'document': 'documents',
        'invoice': 'invoices',
        'interaction': 'interactions',
        'asset': 'assets',
        'service_usage': 'service usage records',
        'bucket_usage': 'bucket usage records'
      };

      return {
        success: false,
        code: 'COMPANY_HAS_DEPENDENCIES',
        message: 'Cannot delete client with active business records. Consider marking as inactive instead to preserve data integrity.',
        dependencies: dependencies.map((dep: string): string => readableTypes[dep] || dep),
        counts
      };
    }

    // If no dependencies, proceed with deletion (client and associated tax settings)
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // First delete client tax settings to avoid foreign key constraint violations
      const deletedTaxSettings = await trx('client_tax_settings')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedTaxSettings > 0) {
        console.log(`Deleted ${deletedTaxSettings} client tax settings records`);
      }

      // Delete client tax rate associations to avoid foreign key constraint violations
      const deletedTaxRates = await trx('client_tax_rates')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedTaxRates > 0) {
        console.log(`Deleted ${deletedTaxRates} client tax rate records`);
      }

      // Delete client contracts (empty contracts - clients with invoices are blocked earlier)
      const deletedContracts = await trx('client_contracts')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedContracts > 0) {
        console.log(`Deleted ${deletedContracts} client contract records`);
      }

      // Delete billing-related settings
      const deletedBillingCycles = await trx('client_billing_cycles')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedBillingCycles > 0) {
        console.log(`Deleted ${deletedBillingCycles} client billing cycle records`);
      }

      const deletedBillingSettings = await trx('client_billing_settings')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedBillingSettings > 0) {
        console.log(`Deleted ${deletedBillingSettings} client billing settings records`);
      }

      // Delete payment customer records (Stripe/payment provider associations)
      const deletedPaymentCustomers = await trx('client_payment_customers')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedPaymentCustomers > 0) {
        console.log(`Deleted ${deletedPaymentCustomers} client payment customer records`);
      }

      // Clean up client locations (addresses don't block deletion per PSA best practices)
      const deletedLocations = await trx('client_locations')
        .where({ client_id: clientId, tenant })
        .delete();

      if (deletedLocations > 0) {
        console.log(`Deleted ${deletedLocations} client location records`);
      }

      // Clean up notes document if it exists
      const clientRecord = await trx('clients')
        .where({ client_id: clientId, tenant })
        .select('notes_document_id')
        .first();

      if (clientRecord?.notes_document_id) {
        console.log(`Cleaning up notes document: ${clientRecord.notes_document_id}`);

        // Delete block content first (due to FK)
        await trx('document_block_content')
          .where({ tenant, document_id: clientRecord.notes_document_id })
          .delete();

        // Delete document associations
        await trx('document_associations')
          .where({ tenant, document_id: clientRecord.notes_document_id })
          .delete();

        // Delete the document
        await trx('documents')
          .where({ tenant, document_id: clientRecord.notes_document_id })
          .delete();
      }

      // Clean up any tags associated with this client
      await deleteEntityTags(trx, clientId, 'client');

      // Finally delete the client record itself
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
    const { findTagsByEntityIds } = await import('server/src/lib/actions/tagActions');
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

  const results: ImportClientResult[] = [];
  const {knex: db, tenant} = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Check permissions for both create and update operations since import can do both
  if (!await hasPermission(currentUser, 'client', 'create')) {
    throw new Error('Permission denied: Cannot create clients');
  }

  if (updateExisting && !await hasPermission(currentUser, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update clients');
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

/**
 * Deactivate all active contacts for a client
 */
export async function deactivateClientContacts(
  clientId: string
): Promise<{ success: boolean; contactsDeactivated: number; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, contactsDeactivated: 0, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, contactsDeactivated: 0, message: 'User not authenticated' };
  }

  // Check permission for contact updating
  if (!await hasPermission(currentUser, 'contact', 'update')) {
    return { success: false, contactsDeactivated: 0, message: 'Permission denied: Cannot update contacts. Please contact your administrator if you need additional access.' };
  }

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get all active contact IDs for this client
      const activeContacts = await trx('contacts')
        .select('contact_name_id')
        .where({ client_id: clientId, tenant, is_inactive: false });

      const contactIds = activeContacts.map((c: { contact_name_id: string }) => c.contact_name_id);

      if (contactIds.length === 0) {
        return { contactsDeactivated: 0 };
      }

      // Deactivate all contacts
      await trx('contacts')
        .where({ client_id: clientId, tenant, is_inactive: false })
        .update({ is_inactive: true });

      // Deactivate all users associated with these contacts
      await trx('users')
        .whereIn('contact_id', contactIds)
        .andWhere({ tenant, user_type: 'client' })
        .update({ is_inactive: true });

      return { contactsDeactivated: contactIds.length };
    });

    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/contacts`);

    return { success: true, contactsDeactivated: result.contactsDeactivated };
  } catch (error) {
    console.error('Error deactivating client contacts:', error);
    const message = error instanceof Error ? error.message : 'Failed to deactivate client contacts';
    return { success: false, contactsDeactivated: 0, message };
  }
}

/**
 * Mark a client as inactive and optionally deactivate all contacts atomically
 * This ensures both operations succeed or fail together
 */
export async function markClientInactiveWithContacts(
  clientId: string,
  deactivateContacts: boolean = true
): Promise<{ success: boolean; contactsDeactivated: number; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, contactsDeactivated: 0, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, contactsDeactivated: 0, message: 'User not authenticated' };
  }

  // Check permission for client updating
  if (!await hasPermission(currentUser, 'client', 'update')) {
    return { success: false, contactsDeactivated: 0, message: 'Permission denied: Cannot update clients. Please contact your administrator if you need additional access.' };
  }

  // If deactivating contacts, also check contact permission
  if (deactivateContacts && !await hasPermission(currentUser, 'contact', 'update')) {
    return { success: false, contactsDeactivated: 0, message: 'Permission denied: Cannot update contacts. Please contact your administrator if you need additional access.' };
  }

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let contactsDeactivated = 0;

      if (deactivateContacts) {
        // Get all active contact IDs for this client
        const activeContacts = await trx('contacts')
          .select('contact_name_id')
          .where({ client_id: clientId, tenant, is_inactive: false });

        const contactIds = activeContacts.map((c: { contact_name_id: string }) => c.contact_name_id);

        if (contactIds.length > 0) {
          // Deactivate all contacts
          await trx('contacts')
            .where({ client_id: clientId, tenant, is_inactive: false })
            .update({ is_inactive: true });

          // Deactivate all users associated with these contacts
          await trx('users')
            .whereIn('contact_id', contactIds)
            .andWhere({ tenant, user_type: 'client' })
            .update({ is_inactive: true });

          contactsDeactivated = contactIds.length;
        }
      }

      // Mark the client as inactive
      await trx('clients')
        .where({ client_id: clientId, tenant })
        .update({ is_inactive: true, updated_at: new Date().toISOString() });

      return { contactsDeactivated };
    });

    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/contacts`);

    return { success: true, contactsDeactivated: result.contactsDeactivated };
  } catch (error) {
    console.error('Error marking client and contacts as inactive:', error);
    const message = error instanceof Error ? error.message : 'Failed to mark client as inactive';
    return { success: false, contactsDeactivated: 0, message };
  }
}

/**
 * Mark a client as active and optionally reactivate all contacts atomically
 * This ensures both operations succeed or fail together
 */
export async function markClientActiveWithContacts(
  clientId: string,
  reactivateContacts: boolean = false
): Promise<{ success: boolean; contactsReactivated: number; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, contactsReactivated: 0, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, contactsReactivated: 0, message: 'User not authenticated' };
  }

  // Check permission for client updating
  if (!await hasPermission(currentUser, 'client', 'update')) {
    return { success: false, contactsReactivated: 0, message: 'Permission denied: Cannot update clients. Please contact your administrator if you need additional access.' };
  }

  // If reactivating contacts, also check contact permission
  if (reactivateContacts && !await hasPermission(currentUser, 'contact', 'update')) {
    return { success: false, contactsReactivated: 0, message: 'Permission denied: Cannot update contacts. Please contact your administrator if you need additional access.' };
  }

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let contactsReactivated = 0;

      // Mark the client as active first
      await trx('clients')
        .where({ client_id: clientId, tenant })
        .update({ is_inactive: false, updated_at: new Date().toISOString() });

      if (reactivateContacts) {
        // Get all inactive contact IDs for this client
        const inactiveContacts = await trx('contacts')
          .select('contact_name_id')
          .where({ client_id: clientId, tenant, is_inactive: true });

        const contactIds = inactiveContacts.map((c: { contact_name_id: string }) => c.contact_name_id);

        if (contactIds.length > 0) {
          // Reactivate all contacts
          await trx('contacts')
            .where({ client_id: clientId, tenant, is_inactive: true })
            .update({ is_inactive: false });

          // Reactivate all users associated with these contacts
          await trx('users')
            .whereIn('contact_id', contactIds)
            .andWhere({ tenant, user_type: 'client' })
            .update({ is_inactive: false });

          contactsReactivated = contactIds.length;
        }
      }

      return { contactsReactivated };
    });

    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/contacts`);

    return { success: true, contactsReactivated: result.contactsReactivated };
  } catch (error) {
    console.error('Error marking client and contacts as active:', error);
    const message = error instanceof Error ? error.message : 'Failed to mark client as active';
    return { success: false, contactsReactivated: 0, message };
  }
}

/**
 * Reactivate all inactive contacts for a client
 */
export async function reactivateClientContacts(
  clientId: string
): Promise<{ success: boolean; contactsReactivated: number; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, contactsReactivated: 0, message: 'Tenant not found' };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, contactsReactivated: 0, message: 'User not authenticated' };
  }

  // Check permission for contact updating
  if (!await hasPermission(currentUser, 'contact', 'update')) {
    return { success: false, contactsReactivated: 0, message: 'Permission denied: Cannot update contacts' };
  }

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get all inactive contact IDs for this client
      const inactiveContacts = await trx('contacts')
        .select('contact_name_id')
        .where({ client_id: clientId, tenant, is_inactive: true });

      const contactIds = inactiveContacts.map((c: { contact_name_id: string }) => c.contact_name_id);

      if (contactIds.length === 0) {
        return { contactsReactivated: 0 };
      }

      // Reactivate all contacts
      await trx('contacts')
        .where({ client_id: clientId, tenant, is_inactive: true })
        .update({ is_inactive: false });

      // Reactivate all users associated with these contacts
      await trx('users')
        .whereIn('contact_id', contactIds)
        .andWhere({ tenant, user_type: 'client' })
        .update({ is_inactive: false });

      return { contactsReactivated: contactIds.length };
    });

    revalidatePath(`/msp/clients/${clientId}`);
    revalidatePath(`/msp/contacts`);

    return { success: true, contactsReactivated: result.contactsReactivated };
  } catch (error) {
    console.error('Error reactivating client contacts:', error);
    const message = error instanceof Error ? error.message : 'Failed to reactivate client contacts';
    return { success: false, contactsReactivated: 0, message };
  }
}
