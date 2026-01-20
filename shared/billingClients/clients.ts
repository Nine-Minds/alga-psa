import type { Knex } from 'knex';
import type { IClient } from '@alga-psa/types';
import type { ClientPaginationParams, PaginatedClientsResponse } from './types';

export async function getClientById(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClient | null> {
  const client = await knexOrTrx<IClient>('clients')
    .where({ tenant, client_id: clientId })
    .first();

  if (!client) return null;
  return { ...client, properties: (client as any).properties ?? {} } as IClient;
}

export async function getAllClients(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  includeInactive: boolean = true
): Promise<IClient[]> {
  const query = knexOrTrx<IClient>('clients')
    .where({ tenant })
    .orderBy('client_name', 'asc')
    .select('*');

  if (!includeInactive) {
    query.andWhere({ is_inactive: false });
  }

  const rows = await query;
  return rows.map((c) => ({ ...c, properties: (c as any).properties ?? {} } as IClient));
}

export async function getAllClientsPaginated(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  params: ClientPaginationParams = {}
): Promise<PaginatedClientsResponse> {
  const {
    page = 1,
    pageSize = 10,
    includeInactive = true,
    searchTerm,
    clientTypeFilter = 'all',
    statusFilter,
    sortBy = 'client_name',
    sortDirection = 'asc',
  } = params;

  const offset = (page - 1) * pageSize;

  let baseQuery = knexOrTrx('clients as c')
    .leftJoin('users as u', function joinUsers() {
      this.on('c.account_manager_id', '=', 'u.user_id').andOn('c.tenant', '=', 'u.tenant');
    })
    .leftJoin('client_locations as cl', function joinLocations() {
      this.on('c.client_id', '=', 'cl.client_id')
        .andOn('c.tenant', '=', 'cl.tenant')
        .andOn('cl.is_default', '=', knexOrTrx.raw('true'));
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
    baseQuery = baseQuery.where(function applySearch() {
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

  const countResult = await baseQuery.clone().countDistinct('c.client_id as count').first();
  const totalCount = parseInt((countResult?.count as string) || '0', 10);

  let clientsQuery = baseQuery
    .leftJoin('tenant_companies as tc', function joinTenantCompanies() {
      this.on('c.client_id', '=', 'tc.client_id').andOn('c.tenant', '=', 'tc.tenant');
    })
    .select(
      'c.*',
      'tc.is_default',
      knexOrTrx.raw(
        `CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`
      ),
      'cl.phone as location_phone',
      'cl.email as location_email',
      'cl.address_line1',
      'cl.address_line2',
      'cl.city',
      'cl.state_province',
      'cl.postal_code',
      'cl.country_name'
    );

  const sortColumnMap: Record<string, string> = {
    client_name: 'c.client_name',
    client_type: 'c.client_type',
    phone_no: 'cl.phone',
    address: 'cl.address_line1',
    account_manager_full_name: 'account_manager_full_name',
    url: 'c.url',
    created_at: 'c.created_at',
  };

  const sortColumn = sortColumnMap[sortBy] || 'c.client_name';
  const validSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

  const textColumns = new Set(['client_name', 'client_type', 'address', 'account_manager_full_name', 'url']);
  if (textColumns.has(sortBy)) {
    clientsQuery = clientsQuery.orderByRaw(`LOWER(${sortColumn}) ${validSortDirection}`);
  } else {
    clientsQuery = clientsQuery.orderBy(sortColumn, validSortDirection);
  }

  const rows = (await clientsQuery.limit(pageSize).offset(offset)) as IClient[];
  const clients = rows.map((c) => ({ ...c, properties: (c as any).properties ?? {} } as IClient));

  return {
    clients,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export async function getClientsWithBillingCycleRangePaginated(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  params: ClientPaginationParams
): Promise<PaginatedClientsResponse> {
  const {
    page = 1,
    pageSize = 10,
    includeInactive = true,
    searchTerm,
    clientTypeFilter = 'all',
    statusFilter,
    sortBy = 'client_name',
    sortDirection = 'asc',
    dateRange,
  } = params;

  const offset = (page - 1) * pageSize;

  let baseQuery = knexOrTrx('clients as c')
    .leftJoin('users as u', function joinUsers() {
      this.on('c.account_manager_id', '=', 'u.user_id').andOn('c.tenant', '=', 'u.tenant');
    })
    .leftJoin('client_locations as cl', function joinLocations() {
      this.on('c.client_id', '=', 'cl.client_id')
        .andOn('c.tenant', '=', 'cl.tenant')
        .andOn('cl.is_default', '=', knexOrTrx.raw('true'));
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
    baseQuery = baseQuery.where(function applySearch() {
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

  if (dateRange?.from || dateRange?.to) {
    baseQuery = baseQuery.whereIn('c.client_id', function selectClientIds() {
      this.select('cbc.client_id').from('client_billing_cycles as cbc').where('cbc.tenant', tenant);

      if (dateRange?.from) {
        const rangeFrom = dateRange.from;
        this.andWhere(function endAfterFrom() {
          this.whereNull('cbc.period_end_date').orWhereRaw('cbc.period_end_date >= ?', [rangeFrom]);
        });
      }

      if (dateRange?.to) {
        this.andWhere('cbc.period_start_date', '<=', dateRange.to);
      }
    });
  }

  const countResult = await baseQuery.clone().countDistinct('c.client_id as count').first();
  const totalCount = parseInt((countResult?.count as string) || '0', 10);

  let clientsQuery = baseQuery
    .leftJoin('tenant_companies as tc', function joinTenantCompanies() {
      this.on('c.client_id', '=', 'tc.client_id').andOn('c.tenant', '=', 'tc.tenant');
    })
    .select(
      'c.*',
      'tc.is_default',
      knexOrTrx.raw(
        `CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`
      ),
      'cl.phone as location_phone',
      'cl.email as location_email',
      'cl.address_line1',
      'cl.address_line2',
      'cl.city',
      'cl.state_province',
      'cl.postal_code',
      'cl.country_name'
    );

  const sortColumnMap: Record<string, string> = {
    client_name: 'c.client_name',
    client_type: 'c.client_type',
    phone_no: 'cl.phone',
    address: 'cl.address_line1',
    account_manager_full_name: 'account_manager_full_name',
    url: 'c.url',
    created_at: 'c.created_at',
  };

  const sortColumn = sortColumnMap[sortBy] || 'c.client_name';
  const validSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

  const textColumns = new Set(['client_name', 'client_type', 'address', 'account_manager_full_name', 'url']);
  if (textColumns.has(sortBy)) {
    clientsQuery = clientsQuery.orderByRaw(`LOWER(${sortColumn}) ${validSortDirection}`);
  } else {
    clientsQuery = clientsQuery.orderBy(sortColumn, validSortDirection);
  }

  const rows = (await clientsQuery.limit(pageSize).offset(offset)) as IClient[];
  const clients = rows.map((c) => ({ ...c, properties: (c as any).properties ?? {} } as IClient));

  return {
    clients,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}
