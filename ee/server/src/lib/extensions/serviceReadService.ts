import { getConnection } from '@alga-psa/db'
import type { Knex } from 'knex'

export type ServiceItemKind = 'service' | 'product'
export type ServiceBillingMethod = 'fixed' | 'hourly' | 'usage'

export interface ServiceSummary {
  serviceId: string
  serviceName: string
  itemKind: ServiceItemKind
  billingMethod: ServiceBillingMethod
  serviceTypeId?: string | null
  serviceTypeName?: string | null
  defaultRate: number
  unitOfMeasure: string
  isActive: boolean
  sku?: string | null
}

export interface ServicesListInput {
  search?: string
  itemKind?: ServiceItemKind
  isActive?: boolean
  billingMethod?: ServiceBillingMethod
  page?: number
  pageSize?: number
}

export interface PaginatedServicesResult {
  items: ServiceSummary[]
  totalCount: number
  page: number
  pageSize: number
}

function applyServiceFilters(query: Knex.QueryBuilder, input: Omit<ServicesListInput, 'page' | 'pageSize'>): Knex.QueryBuilder {
  if (input.itemKind) {
    query.where('sc.item_kind', input.itemKind)
  }

  if (typeof input.isActive === 'boolean') {
    query.where('sc.is_active', input.isActive)
  }

  if (input.billingMethod) {
    query.where('sc.billing_method', input.billingMethod)
  }

  if (input.search) {
    const term = `%${input.search}%`
    query.andWhere((builder) => {
      builder
        .whereILike('sc.service_name', term)
        .orWhereILike('sc.description', term)
        .orWhereILike('sc.sku', term)
    })
  }

  return query
}

function mapServiceSummary(row: any): ServiceSummary {
  return {
    serviceId: String(row.service_id),
    serviceName: String(row.service_name),
    itemKind: row.item_kind === 'product' ? 'product' : 'service',
    billingMethod: row.billing_method,
    serviceTypeId: row.custom_service_type_id ?? null,
    serviceTypeName: row.service_type_name ?? null,
    defaultRate: Number(row.default_rate ?? 0),
    unitOfMeasure: String(row.unit_of_measure ?? ''),
    isActive: Boolean(row.is_active),
    sku: row.sku ?? null,
  }
}

export const __testOnly = {
  mapServiceSummary,
}

export async function listServiceSummaries(tenantId: string, input: ServicesListInput): Promise<PaginatedServicesResult> {
  const knex = await getConnection(tenantId)
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 25
  const offset = (page - 1) * pageSize

  const normalized: Omit<ServicesListInput, 'page' | 'pageSize'> = {
    search: input.search?.trim() ?? undefined,
    itemKind: input.itemKind,
    isActive: input.isActive,
    billingMethod: input.billingMethod,
  }

  const baseQuery = knex('service_catalog as sc').where({ 'sc.tenant': tenantId })
  applyServiceFilters(baseQuery, normalized)

  const countRow = await baseQuery.clone().count<{ count: string }[]>({ count: '*' }).first()
  const totalCount = Number(countRow?.count ?? 0)

  const rows = await applyServiceFilters(
    knex('service_catalog as sc')
      .leftJoin('service_types as st', function () {
        this.on('st.id', '=', 'sc.custom_service_type_id').andOn('st.tenant', '=', 'sc.tenant')
      })
      .where({ 'sc.tenant': tenantId })
      .select([
        'sc.service_id',
        'sc.service_name',
        'sc.item_kind',
        'sc.billing_method',
        'sc.custom_service_type_id',
        'sc.default_rate',
        'sc.unit_of_measure',
        'sc.is_active',
        'sc.sku',
        'st.name as service_type_name',
      ]),
    normalized,
  )
    .orderBy('sc.service_name', 'asc')
    .limit(pageSize)
    .offset(offset)

  return {
    items: rows.map(mapServiceSummary),
    totalCount,
    page,
    pageSize,
  }
}

export async function getServiceSummaryById(tenantId: string, serviceId: string): Promise<ServiceSummary | null> {
  const knex = await getConnection(tenantId)

  const row = await knex('service_catalog as sc')
    .leftJoin('service_types as st', function () {
      this.on('st.id', '=', 'sc.custom_service_type_id').andOn('st.tenant', '=', 'sc.tenant')
    })
    .where({ 'sc.tenant': tenantId, 'sc.service_id': serviceId })
    .first([
      'sc.service_id',
      'sc.service_name',
      'sc.item_kind',
      'sc.billing_method',
      'sc.custom_service_type_id',
      'sc.default_rate',
      'sc.unit_of_measure',
      'sc.is_active',
      'sc.sku',
      'st.name as service_type_name',
    ])

  if (!row) {
    return null
  }

  return mapServiceSummary(row)
}
