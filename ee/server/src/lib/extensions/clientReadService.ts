import { getConnection } from 'server/src/lib/db'
import type { Knex } from 'knex'

export interface ClientSummary {
  clientId: string
  clientName: string
  clientType?: 'company' | 'individual' | null
  isInactive: boolean
  defaultCurrencyCode?: string | null
  accountManagerId?: string | null
  accountManagerName?: string | null
  billingEmail?: string | null
}

export interface ClientsListInput {
  search?: string
  includeInactive?: boolean
  page?: number
  pageSize?: number
}

export interface PaginatedClientsResult {
  items: ClientSummary[]
  totalCount: number
  page: number
  pageSize: number
}

function applyClientFilters(query: Knex.QueryBuilder, input: Required<Pick<ClientsListInput, 'search' | 'includeInactive'>>): Knex.QueryBuilder {
  if (!input.includeInactive) {
    query.where('c.is_inactive', false)
  }

  if (input.search) {
    const term = `%${input.search}%`
    query.andWhere((builder) => {
      builder
        .whereILike('c.client_name', term)
        .orWhereILike('c.client_id', term)
        .orWhereILike('c.billing_email', term)
    })
  }

  return query
}

function mapClientSummary(row: any): ClientSummary {
  return {
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    clientType: row.client_type ?? null,
    isInactive: Boolean(row.is_inactive),
    defaultCurrencyCode: row.default_currency_code ?? null,
    accountManagerId: row.account_manager_id ?? null,
    accountManagerName: row.account_manager_name ?? null,
    billingEmail: row.billing_email ?? null,
  }
}

export const __testOnly = {
  mapClientSummary,
}

export async function listClientSummaries(tenantId: string, input: ClientsListInput): Promise<PaginatedClientsResult> {
  const knex = await getConnection(tenantId)
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 25
  const offset = (page - 1) * pageSize
  const normalized = {
    search: input.search?.trim() ?? '',
    includeInactive: Boolean(input.includeInactive),
  }

  const baseQuery = knex('clients as c').where({ 'c.tenant': tenantId })
  applyClientFilters(baseQuery, normalized)

  const countRow = await baseQuery.clone().count<{ count: string }[]>({ count: '*' }).first()
  const totalCount = Number(countRow?.count ?? 0)

  const rows = await applyClientFilters(
    knex('clients as c')
      .leftJoin('users as u', function () {
        this.on('u.user_id', '=', 'c.account_manager_id').andOn('u.tenant', '=', 'c.tenant')
      })
      .where({ 'c.tenant': tenantId })
      .select([
        'c.client_id',
        'c.client_name',
        'c.client_type',
        'c.is_inactive',
        'c.default_currency_code',
        'c.account_manager_id',
        'c.billing_email',
        knex.raw("NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') as account_manager_name"),
      ]),
    normalized,
  )
    .orderBy('c.client_name', 'asc')
    .limit(pageSize)
    .offset(offset)

  return {
    items: rows.map(mapClientSummary),
    totalCount,
    page,
    pageSize,
  }
}

export async function getClientSummaryById(tenantId: string, clientId: string): Promise<ClientSummary | null> {
  const knex = await getConnection(tenantId)

  const row = await knex('clients as c')
    .leftJoin('users as u', function () {
      this.on('u.user_id', '=', 'c.account_manager_id').andOn('u.tenant', '=', 'c.tenant')
    })
    .where({ 'c.tenant': tenantId, 'c.client_id': clientId })
    .first([
      'c.client_id',
      'c.client_name',
      'c.client_type',
      'c.is_inactive',
      'c.default_currency_code',
      'c.account_manager_id',
      'c.billing_email',
      knex.raw("NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') as account_manager_name"),
    ])

  if (!row) {
    return null
  }

  return mapClientSummary(row)
}
