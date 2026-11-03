import type { Knex } from 'knex';

import type { IUserWithRoles } from '@alga-psa/types';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@alga-psa/types';

import { registeredObjectTypes } from './index';
import {
  resolveSearchAclPrincipal,
  verifyResultVisibility,
  type ClientAccess,
} from './acl';
import {
  decodeSearchCursor,
  encodeSearchCursor,
  runSearchQuery,
  type SearchIndexHit,
  type SearchQueryOptions,
} from './query';
import {
  searchAppResultSchema,
  type SearchAppInput,
  type SearchAppResult,
  type SearchResultRow,
} from './actions/searchActionShared';

const SEARCH_OBJECT_TYPE_SET = new Set<string>(SEARCH_OBJECT_TYPES);

// Coarse query-time gate: a type is queried only if the user holds at least
// one of these permissions. The precise per-row filter is the stored
// `required_permission` enforced by aclPredicateSql. Types whose rows can
// require different permissions (e.g. `status` spans ticket vs project
// statuses) list all of them so no class of user is wrongly excluded.
export const TYPE_REQUIRED_PERMISSION: Record<SearchObjectType, string | readonly string[]> = {
  client: 'client:read',
  contact: 'contact:read',
  user: 'user:read',
  ticket: 'ticket:read',
  ticket_comment: 'ticket:read',
  project: 'project:read',
  project_phase: 'project:read',
  project_task: 'project:read',
  project_task_comment: 'project:read',
  asset: 'asset:read',
  sales_order: 'sales_order:read',
  purchase_order: 'purchase_order:read',
  stock_unit: 'inventory:read',
  invoice: 'invoice:read',
  invoice_item: 'invoice:read',
  invoice_annotation: 'invoice:read',
  contract: 'contract:read',
  client_contract: 'contract:read',
  document: 'document:read',
  kb_article: 'kb:read',
  service_catalog: 'service_catalog:read',
  service_request_submission: 'service_request:read',
  service_request_definition: 'admin',
  workflow_task: 'workflow_task:read',
  interaction: 'interaction:read',
  schedule_entry: 'schedule:read',
  time_entry: 'time:read',
  board: 'ticket:read',
  category: 'ticket:read',
  tag: 'ticket:read',
  status: ['ticket:read', 'project:read'],
};

export function normalizeLimit(limit: number | undefined): number {
  const parsed = Number(limit ?? 30);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 100));
}

export function resolveAllowedTypes(inputTypes: SearchObjectType[] | undefined): SearchObjectType[] {
  const registered = registeredObjectTypes()
    .filter((type): type is SearchObjectType => SEARCH_OBJECT_TYPE_SET.has(type));
  if (!inputTypes || inputTypes.length === 0) {
    return registered;
  }

  const requested = new Set(inputTypes);
  return registered.filter((type) => requested.has(type));
}

export function filterTypesByPermission(
  types: SearchObjectType[],
  permissions: readonly string[],
): SearchObjectType[] {
  const permissionSet = new Set(permissions);
  return types.filter((type) => {
    const required = TYPE_REQUIRED_PERMISSION[type];
    const candidates = Array.isArray(required) ? required : [required];
    return candidates.some((permission) => permissionSet.has(permission));
  });
}

export function emptyGroups(): Record<SearchObjectType, number> {
  return Object.fromEntries(
    SEARCH_OBJECT_TYPES.map((type) => [type, 0]),
  ) as Record<SearchObjectType, number>;
}

/**
 * Single source of truth for which clients a search principal may see.
 *
 * Internal/MSP users are currently unrestricted, so they get `{ mode: 'all' }`
 * — no `clients` table scan and no giant UUID array bound into every search
 * query. Client-portal users are scoped to their own client.
 *
 * When ABAC per-internal-user client restrictions are introduced, the *only*
 * change is here: return `{ mode: 'scoped', clientIds }` for restricted
 * internal users. The SQL predicate and the per-row visibility verifier both
 * consume this mode, so the restriction is enforced in both layers without
 * an `isInternal` shortcut to audit.
 */
export function resolveClientAccess(user: IUserWithRoles): ClientAccess {
  if (user.user_type === 'client') {
    return { mode: 'scoped', clientIds: user.clientId ? [user.clientId] : [] };
  }

  return { mode: 'all' };
}

export function toSearchResultRow(
  hit: Awaited<ReturnType<typeof runSearchQuery>>[number],
): SearchResultRow {
  return {
    type: hit.type,
    id: hit.id,
    parentId: hit.parentId,
    title: hit.title,
    subtitle: hit.subtitle,
    snippet: hit.snippet,
    url: hit.url,
    score: hit.score,
    updatedAt: hit.updatedAt.toISOString(),
  };
}

const AUTHORIZED_SEARCH_SCAN_SIZE = 100;

function isAfterSearchCursor(
  hit: SearchIndexHit,
  cursor: ReturnType<typeof decodeSearchCursor>,
  sort: 'relevance' | 'recent',
): boolean {
  if (!cursor) return true;

  const updatedAt = hit.updatedAt.toISOString();
  if (sort === 'recent') {
    return updatedAt < cursor.updatedAt
      || (updatedAt === cursor.updatedAt && hit.id > cursor.objectId);
  }

  return hit.score < cursor.score
    || (hit.score === cursor.score && updatedAt < cursor.updatedAt)
    || (hit.score === cursor.score && updatedAt === cursor.updatedAt && hit.id > cursor.objectId);
}

/**
 * Enumerate and authorize every candidate before deriving result rows, counts,
 * or pagination. Applying authorization after SQL pagination lets denied rows
 * consume a page and can leak through aggregate counts.
 */
export async function runAuthorizedSearchCandidates(input: {
  knex: Knex;
  tenant: string;
  user: IUserWithRoles;
  query: string;
  requestedTypes: SearchObjectType[];
  pageSize: number;
  cursor?: string;
  sort?: 'relevance' | 'recent';
  includeSnippets?: boolean;
  searchIndex?: SearchQueryOptions['searchIndex'];
}): Promise<{ visibleHits: SearchIndexHit[]; groups: Record<SearchObjectType, number> }> {
  const sort = input.sort ?? 'relevance';
  // Validate at the action boundary even though this cursor is applied after
  // authorization rather than to the raw candidate query.
  const pageCursor = decodeSearchCursor(input.cursor);
  const clientAccess = resolveClientAccess(input.user);
  const acl = await resolveSearchAclPrincipal(input.knex, input.user, clientAccess);
  const allowedTypes = filterTypesByPermission(input.requestedTypes, acl.permissions);
  const visibleHits: SearchIndexHit[] = [];
  const groups = emptyGroups();
  let candidateCursor: string | undefined;

  while (true) {
    const batch = await runSearchQuery({
      knex: input.knex,
      tenant: input.tenant,
      query: input.query,
      allowedTypes,
      limit: AUTHORIZED_SEARCH_SCAN_SIZE,
      cursor: candidateCursor,
      sort,
      includeSnippets: input.includeSnippets,
      acl,
      searchIndex: input.searchIndex,
    });
    if (batch.length === 0) break;

    const admitted = await verifyResultVisibility(input.knex, acl, batch);
    for (const hit of admitted) {
      groups[hit.type] += 1;
      if (visibleHits.length <= input.pageSize && isAfterSearchCursor(hit, pageCursor, sort)) {
        visibleHits.push(hit);
      }
    }

    if (batch.length < AUTHORIZED_SEARCH_SCAN_SIZE) break;
    const nextCursor = encodeSearchCursor(batch[batch.length - 1]);
    if (nextCursor === candidateCursor) {
      throw new Error('Search candidate scan did not advance its cursor');
    }
    candidateCursor = nextCursor;
  }

  return {
    visibleHits,
    groups,
  };
}

/**
 * Core full-text search over `app_search_index`, shared by the in-app server
 * action (`searchAppAction`) and the public REST endpoint (`GET /api/v1/search`).
 *
 * It is intentionally free of transport concerns (no auth wrapper, no rate
 * limiting, no telemetry) so both callers enforce ACL/permission filtering
 * identically — keeping the security-critical logic single-sourced. Callers
 * are responsible for authentication, tenant context, and providing a
 * permissioned `user` (with roles) plus an explicit tenant `knex`.
 */
export async function runAppSearch(
  knex: Knex,
  tenant: string,
  user: IUserWithRoles,
  input: SearchAppInput,
  searchIndex?: SearchQueryOptions['searchIndex'],
): Promise<SearchAppResult> {
  const limit = normalizeLimit(input.limit);
  const requestedTypes = resolveAllowedTypes(input.types);
  const { visibleHits, groups } = await runAuthorizedSearchCandidates({
    knex,
    tenant,
    user,
    query: input.query,
    requestedTypes,
    pageSize: limit,
    cursor: input.cursor,
    sort: input.sort,
    includeSnippets: true,
    searchIndex,
  });
  const pageHits = visibleHits.slice(0, limit);
  const totalCount = Object.values(groups).reduce((sum, value) => sum + value, 0);

  const lastHit = pageHits[pageHits.length - 1];
  const result: SearchAppResult = {
    results: pageHits.map(toSearchResultRow),
    groups,
    totalCount,
    nextCursor: visibleHits.length > limit && lastHit ? encodeSearchCursor(lastHit) : undefined,
  };

  return searchAppResultSchema.parse(result) as SearchAppResult;
}
