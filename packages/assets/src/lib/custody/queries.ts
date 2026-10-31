import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  CustodyQueueTab,
  IAssetCustodyDetail,
  ICustodyQueueFilters,
  ICustodyQueuePage,
  ICustodyQueueRow,
} from '@alga-psa/types';
import { CUSTODY_QUEUE_TABS } from '@alga-psa/types';
import {
  filterReadableAssets,
  type AssetReadAuthorizationContext,
} from '../assetReadAuthorization';
import { CUSTODY_COLUMNS, FOLLOW_UP_SELECT, mapCustodyRow } from './shared';

/**
 * Custody reads. Open/closed is decided by `asset_custody.closed_at`, never by `assets.status`
 * (RMM sync and manual edits can change status; the episode row is the source of truth).
 */

function detailSelect(trx: Knex) {
  return [
    ...CUSTODY_COLUMNS.map((c) => `c.${c}`),
    trx.raw("to_char(c.follow_up_on, 'YYYY-MM-DD') as follow_up_on"),
    'l.name as location_name',
    trx.raw("nullif(trim(concat_ws(' ', h.first_name, h.last_name)), '') as holder_name"),
    't.ticket_number as ticket_number',
  ];
}

function baseQuery(trx: Knex, tenant: string) {
  return tenantDb(trx, tenant)
    .table('asset_custody as c')
    .leftJoin('stock_locations as l', function joinLocation() {
      this.on('l.tenant', 'c.tenant').andOn('l.location_id', 'c.location_id');
    })
    .leftJoin('users as h', function joinHolder() {
      this.on('h.tenant', 'c.tenant').andOn('h.user_id', 'c.holder_user_id');
    })
    .leftJoin('tickets as t', function joinTicket() {
      this.on('t.tenant', 'c.tenant').andOn('t.ticket_id', 'c.ticket_id');
    });
}

function toDetail(row: any): IAssetCustodyDetail {
  return {
    ...mapCustodyRow(row),
    location_name: row.location_name ?? null,
    holder_name: row.holder_name ?? null,
    ticket_number: row.ticket_number ?? null,
  };
}

/** The open episode per asset (absent key = not in custody). Not authorization-filtered: callers filter. */
export async function getOpenCustodyForAssets(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetIds: readonly string[]
): Promise<Map<string, IAssetCustodyDetail>> {
  const out = new Map<string, IAssetCustodyDetail>();
  if (assetIds.length === 0) return out;
  const rows = await baseQuery(trx as Knex, tenant)
    .whereIn('c.asset_id', [...assetIds])
    .whereNull('c.closed_at')
    .select(detailSelect(trx as Knex) as any);
  for (const row of rows) out.set(row.asset_id, toDetail(row));
  return out;
}

/** All episodes (open and closed) of one asset, newest first. */
export async function listCustodyEpisodes(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<IAssetCustodyDetail[]> {
  const rows = await baseQuery(trx as Knex, tenant)
    .where({ 'c.asset_id': assetId })
    .orderBy('c.opened_at', 'desc')
    .select(detailSelect(trx as Knex) as any);
  return rows.map(toDetail);
}

export function matchesQueueTab(row: IAssetCustodyDetail, tab: CustodyQueueTab, today: string): boolean {
  switch (tab) {
    case 'all_open':
      return true;
    case 'in_office':
      return row.state === 'in_office';
    case 'waiting_on_vendor':
      return row.state === 'with_vendor' || row.next_action_party === 'vendor';
    case 'waiting_on_client':
      return row.state === 'in_office' && row.next_action_party === 'client';
    case 'overdue':
      return row.follow_up_on !== null && row.follow_up_on < today;
  }
}

export interface ListCustodyQueueOptions {
  /**
   * Required. The caller's local calendar date `YYYY-MM-DD` (user time zone, then tenant, then UTC), for
   * "overdue" (`follow_up_on < today`). There is deliberately no default: a UTC fallback would flip
   * overdue at the wrong hour for non-UTC users. See `resolveCustodyToday` in service.ts.
   */
  today: string;
  /** Caller's user id, for `mine`. */
  userId?: string;
}

/**
 * The open-episode queue. Every row is filtered through the record-level asset read check before it is
 * counted or returned, so totals and tab counts never reveal an asset the caller cannot read.
 * Open episodes are few (equipment physically on shelves), so rows are filtered then paged in memory.
 */
export async function listCustodyQueue(
  trx: Knex | Knex.Transaction,
  tenant: string,
  authContext: AssetReadAuthorizationContext,
  filters: ICustodyQueueFilters,
  options: ListCustodyQueueOptions
): Promise<ICustodyQueuePage> {
  const { today } = options;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 25;

  const q = baseQuery(trx as Knex, tenant)
    .join('assets as a', function joinAsset() {
      this.on('a.tenant', 'c.tenant').andOn('a.asset_id', 'c.asset_id');
    })
    .leftJoin('clients as cl', function joinClient() {
      this.on('cl.tenant', 'c.tenant').andOn('cl.client_id', 'c.client_id');
    })
    .whereNull('c.closed_at');
  if (filters.client_id) q.where('c.client_id', filters.client_id);
  if (filters.location_id) q.where('c.location_id', filters.location_id);
  if (filters.holder_user_id) q.where('c.holder_user_id', filters.holder_user_id);
  if (filters.purpose) q.where('c.purpose', filters.purpose);
  if (filters.next_action_party) q.where('c.next_action_party', filters.next_action_party);
  if (filters.mine && options.userId) q.where('c.holder_user_id', options.userId);

  const rows: Array<ICustodyQueueRow & { _a: { asset_id: string; client_id: string | null } }> = (
    await q
      .orderByRaw('c.follow_up_on asc nulls last')
      .orderBy('c.opened_at', 'asc')
      .select([
        ...detailSelect(trx as Knex),
        'a.asset_tag as asset_tag',
        'a.name as asset_name',
        'a.client_id as asset_client_id',
        'cl.client_name as client_name',
      ] as any)
  ).map((row: any) => ({
    ...toDetail(row),
    asset_tag: row.asset_tag ?? null,
    asset_name: row.asset_name ?? null,
    client_name: row.client_name ?? null,
    days_held: Math.max(0, Math.floor((Date.now() - new Date(row.opened_at).getTime()) / 86_400_000)),
    _a: { asset_id: row.asset_id, client_id: row.asset_client_id ?? null },
  }));

  const readable = await filterReadableAssets(trx, tenant, authContext, rows.map((r) => r._a));
  const readableIds = new Set(readable.map((a) => a.asset_id));
  const visible = rows.filter((r) => readableIds.has(r.asset_id)).map(({ _a, ...row }) => row as ICustodyQueueRow);

  const tabCounts = Object.fromEntries(
    CUSTODY_QUEUE_TABS.map((tab) => [tab, visible.filter((r) => matchesQueueTab(r, tab, today)).length])
  ) as Record<CustodyQueueTab, number>;

  const tab = filters.tab ?? 'all_open';
  const inTab = visible.filter((r) => matchesQueueTab(r, tab, today));
  return {
    rows: inTab.slice((page - 1) * pageSize, page * pageSize),
    total: inTab.length,
    page,
    pageSize,
    tabCounts,
  };
}
