import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunity, IOpportunityListItem, OpportunityListFilters } from '@alga-psa/types';
import { getOpportunitySettings } from './opportunitySettingsModel';

const DEFAULT_STALLED_THRESHOLD_DAYS = 14;

const OPPORTUNITY_LIST_SORT_COLUMNS: Record<NonNullable<OpportunityListFilters['sort_by']>, string> = {
  next_action_due: 'o.next_action_due',
  expected_close_date: 'o.expected_close_date',
  mrr_cents: 'o.mrr_cents',
  last_activity_at: 'o.last_activity_at',
  created_at: 'o.created_at',
};

export interface OpportunityListResult {
  data: IOpportunityListItem[];
  total: number;
  page: number;
  page_size: number;
}

function normalize(row: Record<string, unknown>): IOpportunity {
  return {
    ...row,
    mrr_cents: Number(row.mrr_cents ?? 0),
    nrr_cents: Number(row.nrr_cents ?? 0),
    hardware_cents: Number(row.hardware_cents ?? 0),
    expected_close_date: normalizeOptionalIso(row.expected_close_date),
    next_action_due: normalizeOptionalIso(row.next_action_due),
    last_activity_at: normalizeOptionalIso(row.last_activity_at),
    won_at: normalizeOptionalIso(row.won_at),
    lost_at: normalizeOptionalIso(row.lost_at),
    created_at: normalizeOptionalIso(row.created_at),
    updated_at: normalizeOptionalIso(row.updated_at),
  } as IOpportunity;
}

function normalizeOptionalIso(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeListItem(row: Record<string, unknown>): IOpportunityListItem {
  return {
    opportunity_id: String(row.opportunity_id),
    opportunity_number: String(row.opportunity_number),
    title: String(row.title),
    client_id: String(row.client_id),
    client_name: String(row.client_name ?? ''),
    client_lifecycle_status: (row.client_lifecycle_status ?? 'active') as IOpportunityListItem['client_lifecycle_status'],
    owner_id: String(row.owner_id),
    owner_name: String(row.owner_name ?? ''),
    status: row.status as IOpportunityListItem['status'],
    stage: row.stage as IOpportunityListItem['stage'],
    confidence: row.confidence as IOpportunityListItem['confidence'],
    opportunity_type: row.opportunity_type as IOpportunityListItem['opportunity_type'],
    mrr_cents: Number(row.mrr_cents ?? 0),
    nrr_cents: Number(row.nrr_cents ?? 0),
    hardware_cents: Number(row.hardware_cents ?? 0),
    currency_code: String(row.currency_code),
    expected_close_date: normalizeOptionalIso(row.expected_close_date),
    next_action: row.next_action as IOpportunityListItem['next_action'],
    next_action_due: normalizeOptionalIso(row.next_action_due),
    days_since_activity: Number(row.days_since_activity ?? 0),
    is_stalled: Boolean(row.is_stalled),
  };
}

export const OpportunityModel = {
  async getById(conn: Knex | Knex.Transaction, tenant: string, opportunityId: string): Promise<IOpportunity | null> {
    const row = await tenantDb(conn, tenant).table('opportunities')
      .where({ opportunity_id: opportunityId })
      .first();
    return row ? normalize(row) : null;
  },

  async create(conn: Knex | Knex.Transaction, tenant: string, input: Omit<IOpportunity, 'tenant' | 'opportunity_id'>): Promise<IOpportunity> {
    const [row] = await tenantDb(conn, tenant).table('opportunities')
      .insert({ tenant, ...input })
      .returning('*');
    return normalize(row);
  },

  async update(
    conn: Knex | Knex.Transaction,
    tenant: string,
    opportunityId: string,
    patch: Partial<IOpportunity>,
  ): Promise<IOpportunity> {
    const [row] = await tenantDb(conn, tenant).table('opportunities')
      .where({ opportunity_id: opportunityId })
      .update({ ...patch, updated_at: new Date().toISOString() })
      .returning('*');
    if (!row) throw new Error('Opportunity not found');
    return normalize(row);
  },

  async delete(conn: Knex | Knex.Transaction, tenant: string, opportunityId: string): Promise<boolean> {
    return (await tenantDb(conn, tenant).table('opportunities')
      .where({ opportunity_id: opportunityId, status: 'open' })
      .delete()) > 0;
  },

  async list(
    conn: Knex | Knex.Transaction,
    tenant: string,
    filters: OpportunityListFilters = {},
    stalledThresholdDays?: number,
  ): Promise<OpportunityListResult> {
    stalledThresholdDays ??= (await getOpportunitySettings(conn, tenant)).nudge_days;
    if (!Number.isInteger(stalledThresholdDays) || stalledThresholdDays < 1) {
      throw new Error('Stalled threshold must be a positive whole number of days');
    }

    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.page_size ?? 25, 100);
    const db = tenantDb(conn, tenant);
    const query = db.table('opportunities as o');
    db.tenantJoin(query, 'clients as c', 'o.client_id', 'c.client_id');
    db.tenantJoin(query, 'users as u', 'o.owner_id', 'u.user_id');

    if (filters.status && filters.status !== 'all') query.where('o.status', filters.status);
    if (filters.stage) query.where('o.stage', filters.stage);
    if (filters.owner_id) query.where('o.owner_id', filters.owner_id);
    if (filters.client_id) query.where('o.client_id', filters.client_id);
    if (filters.opportunity_type) query.where('o.opportunity_type', filters.opportunity_type);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query.where(function searchOpportunityList(this: Knex.QueryBuilder) {
        this.whereILike('o.title', term)
          .orWhereILike('o.opportunity_number', term)
          .orWhereILike('c.client_name', term);
      });
    }
    if (filters.stalled_only) {
      query.where('o.status', 'open');
      query.whereRaw("o.last_activity_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')", [stalledThresholdDays]);
    }

    const rows = await query
      .select(
        'o.opportunity_id',
        'o.opportunity_number',
        'o.title',
        'o.client_id',
        'c.client_name',
        'c.lifecycle_status as client_lifecycle_status',
        'o.owner_id',
        conn.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS owner_name"),
        'o.status',
        'o.stage',
        'o.confidence',
        'o.opportunity_type',
        'o.mrr_cents',
        'o.nrr_cents',
        'o.hardware_cents',
        'o.currency_code',
        'o.expected_close_date',
        'o.next_action',
        'o.next_action_due',
        conn.raw("GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o.last_activity_at)) / 86400))::integer AS days_since_activity"),
        conn.raw("(o.status = 'open' AND o.last_activity_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')) AS is_stalled", [stalledThresholdDays]),
        conn.raw('COUNT(*) OVER() AS _total_count'),
      )
      .orderBy(
        OPPORTUNITY_LIST_SORT_COLUMNS[filters.sort_by ?? 'next_action_due'] ?? OPPORTUNITY_LIST_SORT_COLUMNS.next_action_due,
        filters.sort_direction === 'desc' ? 'desc' : 'asc',
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      data: rows.map(normalizeListItem),
      total: Number(rows[0]?._total_count ?? 0),
      page,
      page_size: pageSize,
    };
  },
};
