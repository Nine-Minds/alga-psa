'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { Knex } from 'knex';
import { assertMspPermission } from '../lib/authHelpers';
import { applyClientListIndexedSearchFilter } from '../lib/listSearchSql';
import { getClientLogoUrlsBatchAsync } from '../lib/documentsHelpers';
import { attachDisplayTags } from '../lib/displayTags';
import type { IDisplayTag } from '@alga-psa/types';

const CLIENT_PICKER_DEFAULT_PAGE_SIZE = 25;
const CLIENT_PICKER_MAX_PAGE_SIZE = 50;
/** Upper bound for `ids` lookups (hydrating selected values). */
const CLIENT_PICKER_MAX_LOOKUP_IDS = 100;

export interface PickerClient {
  client_id: string;
  client_name: string;
  client_type: 'company' | 'individual' | null;
  is_inactive: boolean;
  logoUrl: string | null;
  /** Chip tags for the viewer (display rules), in rule order. */
  displayTags: IDisplayTag[];
}

export interface SearchClientsForPickerParams {
  search?: string;
  /** Zero-based page index. */
  page?: number;
  /** Clamped server-side to CLIENT_PICKER_MAX_PAGE_SIZE. */
  pageSize?: number;
  status?: 'active' | 'inactive' | 'all';
  clientType?: 'company' | 'individual' | 'all';
  /** Tag texts; a client matches when it has any of them. */
  tags?: string[];
  /** Removed from results on the server (distinct from the UI's disabledClientIds). */
  excludeIds?: string[];
  /**
   * Lookup-by-id for hydrating selected values. When non-empty, paging, search and
   * filters (incl. excludeIds) are ignored. Tenant scoping still applies.
   */
  ids?: string[];
}

export interface SearchClientsForPickerResult {
  clients: PickerClient[];
  total: number;
}

export const searchClientsForPicker = withAuth(async (
  user,
  { tenant },
  params: SearchClientsForPickerParams = {}
): Promise<SearchClientsForPickerResult> => {
  await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const {
    search,
    status = 'active',
    clientType = 'all',
    tags,
    excludeIds,
    ids,
  } = params;
  const pageSize = Math.min(
    Math.max(Math.floor(params.pageSize ?? CLIENT_PICKER_DEFAULT_PAGE_SIZE), 1),
    CLIENT_PICKER_MAX_PAGE_SIZE
  );
  const page = Math.max(Math.floor(params.page ?? 0), 0);
  const isLookup = Array.isArray(ids) && ids.length > 0;

  const { knex: db } = await createTenantKnex();

  const { rows, total } = await withTransaction(db, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant);
    let query = scopedDb.table('clients as c');

    if (isLookup) {
      query = query.whereIn('c.client_id', ids.slice(0, CLIENT_PICKER_MAX_LOOKUP_IDS));
    } else {
      if (status === 'active') query = query.where('c.is_inactive', false);
      else if (status === 'inactive') query = query.where('c.is_inactive', true);

      if (clientType !== 'all') query = query.where('c.client_type', clientType);

      if (excludeIds && excludeIds.length > 0) query = query.whereNotIn('c.client_id', excludeIds);

      if (tags && tags.length > 0) {
        const tagSubquery = scopedDb.table('tag_mappings as tm').select('tm.tagged_id');
        scopedDb.tenantJoin(tagSubquery, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');
        tagSubquery.where('tm.tagged_type', 'client').whereIn('td.tag_text', tags);
        query = query.whereIn('c.client_id', tagSubquery);
      }

      // Only client:read content is searched (client rows, names, locations) — passing
      // just that permission keeps interaction/document index legs from matching.
      query = applyClientListIndexedSearchFilter(trx, query, tenant, user, search, ['client:read']);
    }

    let totalCount: number;
    if (isLookup) {
      totalCount = 0; // computed from rows below
    } else {
      const countRow = await query.clone().count('c.client_id as count').first();
      totalCount = parseInt((countRow?.count as string | undefined) ?? '0', 10);
    }

    let rowsQuery = query
      .clone()
      .select('c.client_id', 'c.client_name', 'c.client_type', 'c.is_inactive')
      .orderByRaw('LOWER(c.client_name) asc')
      .orderBy('c.client_id', 'asc');
    if (!isLookup) {
      rowsQuery = rowsQuery.limit(pageSize).offset(page * pageSize);
    }
    const found = await rowsQuery;
    return { rows: found, total: isLookup ? found.length : totalCount };
  });

  // Logos only for the rows on this page.
  const logoMap = rows.length > 0
    ? await getClientLogoUrlsBatchAsync(rows.map((r: { client_id: string }) => r.client_id), tenant)
    : new Map<string, string | null>();

  const baseClients = rows.map((r: any) => ({
    client_id: r.client_id,
    client_name: r.client_name,
    client_type: r.client_type ?? null,
    is_inactive: Boolean(r.is_inactive),
    logoUrl: logoMap.get(r.client_id) ?? null,
  }));
  const clients: PickerClient[] = await attachDisplayTags(db, tenant, user, 'client', baseClients, (c) => c.client_id);

  return { clients, total };
});
