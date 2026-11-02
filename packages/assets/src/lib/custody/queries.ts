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
import type { AssetReadAuthorizationContext } from '../assetReadAuthorization';
import { projectReadableAssetRecords } from '../assetReadProjection';
import { ASSET_CUSTODY_QUEUE_SOURCE } from '@alga-psa/co-managed/recordProjection';
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
 * The open-episode queue. Candidates are authorized and projected before filters, totals, tab counts,
 * or pagination, so denied and redacted source data cannot influence the response.
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
    });
  const rows: Array<ICustodyQueueRow & { _a: { asset_id: string; client_id: string | null } }> = (
    await q
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

  const assetById = new Map(rows.map(({ asset_id, _a }) => [asset_id, _a]));
  const projectionCandidates = rows.map(({ _a: _authorizationRecord, ...row }) => row);
  const projections = await projectReadableAssetRecords(
    trx,
    tenant,
    authContext,
    projectionCandidates,
    (row) => assetById.get(row.asset_id)!,
    ASSET_CUSTODY_QUEUE_SOURCE,
  );
  const requestedFilters: Array<[keyof ICustodyQueueRow, unknown]> = [
    ['client_id', filters.client_id],
    ['location_id', filters.location_id],
    ['holder_user_id', filters.holder_user_id],
    ['purpose', filters.purpose],
    ['next_action_party', filters.next_action_party],
    ...(filters.mine && options.userId ? [['holder_user_id', options.userId] as [keyof ICustodyQueueRow, unknown]] : []),
  ];
  const visible = projections.flatMap(({ record, policy }) => {
    const row = record as ICustodyQueueRow;
    const isOpen = policy.readable('closed_at', ASSET_CUSTODY_QUEUE_SOURCE) && row.closed_at === null;
    const matchesFilters = requestedFilters.every(([field, value]) =>
      value === undefined || (policy.readable(field, ASSET_CUSTODY_QUEUE_SOURCE) && row[field] === value));
    return isOpen && matchesFilters ? [{ row, policy }] : [];
  });

  const readableDate = (row: ICustodyQueueRow, field: 'follow_up_on' | 'opened_at', policy: (typeof projections)[number]['policy']) => {
    if (!policy.readable(field, ASSET_CUSTODY_QUEUE_SOURCE)) return Number.POSITIVE_INFINITY;
    const timestamp = row[field] ? new Date(row[field] as string).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
  };
  visible.sort((a, b) =>
    readableDate(a.row, 'follow_up_on', a.policy) - readableDate(b.row, 'follow_up_on', b.policy)
    || readableDate(a.row, 'opened_at', a.policy) - readableDate(b.row, 'opened_at', b.policy));
  const visibleRows = visible.map(({ row }) => row);

  const tabCounts = Object.fromEntries(
    CUSTODY_QUEUE_TABS.map((tab) => [tab, visibleRows.filter((r) => matchesQueueTab(r, tab, today)).length])
  ) as Record<CustodyQueueTab, number>;

  const tab = filters.tab ?? 'all_open';
  const inTab = visibleRows.filter((r) => matchesQueueTab(r, tab, today));
  return {
    rows: inTab.slice((page - 1) * pageSize, page * pageSize),
    total: inTab.length,
    page,
    pageSize,
    tabCounts,
  };
}
