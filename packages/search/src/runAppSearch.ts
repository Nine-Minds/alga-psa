import type { Knex } from 'knex';

import type { IUserWithRoles } from '@alga-psa/types';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@alga-psa/types';

import { resolveReadableScope } from '@alga-psa/authorization/subject';

import { registeredObjectTypes } from './index';
import {
  resolveSearchAclPrincipal,
  verifyResultVisibility,
  type ClientAccess,
} from './acl';
import {
  countSearchMatchesByType,
  encodeSearchCursor,
  runSearchQuery,
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
 * Resources whose `read` rules bound the clients a search principal may see. Search has one client
 * set per principal, so it is the intersection over these: a restriction on any of them narrows
 * every client-keyed search result (fail closed).
 */
// LEVERAGE: friction search-single-client-set — one client set per principal makes a bundle that restricts only
// one resource (say assets) narrow every search type; per-type sets would follow each resource's own rules.
export const SEARCH_CLIENT_RESOURCES = [
  'client',
  'contact',
  'ticket',
  'project',
  'asset',
  'document',
  'interaction',
  'time_entry',
] as const;

/**
 * Single source of truth for which clients and boards a search principal may see.
 *
 * Client-portal users are scoped to their own client. An internal/MSP user is resolved through the
 * authorization subject resolver and their bundle rules: when those restrict clients they get
 * `{ mode: 'scoped', clientIds }`, when they restrict ticket boards they also get `boardIds`.
 * The SQL predicate and the per-row visibility verifier both consume this value, so the
 * restriction is enforced in both layers without an `isInternal` shortcut to audit.
 *
 * Unrestricted users stay on `{ mode: 'all' }`: in a tenant with no published bundle assignment the
 * cached tenant probe is the only query (no subject load, no rule load, no `clients` scan, no
 * UUID array bound into the search query).
 */
export async function resolveClientAccess(
  knex: Knex,
  tenant: string,
  user: IUserWithRoles,
): Promise<ClientAccess> {
  if (user.user_type === 'client') {
    return { mode: 'scoped', clientIds: user.clientId ? [user.clientId] : [] };
  }

  const scope = await resolveReadableScope(knex, {
    tenant,
    user,
    clientResources: SEARCH_CLIENT_RESOURCES,
    boardResource: 'ticket',
  });
  const boards = scope.boardIds === null ? {} : { boardIds: scope.boardIds };
  return scope.clientIds === null
    ? { mode: 'all', ...boards }
    : { mode: 'scoped', clientIds: scope.clientIds, ...boards };
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
  const clientAccess = await resolveClientAccess(knex, tenant, user);
  const acl = await resolveSearchAclPrincipal(knex, user, clientAccess);
  const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

  const [hits, typeCounts] = await Promise.all([
    runSearchQuery({
      knex,
      tenant,
      query: input.query,
      allowedTypes,
      limit: limit + 1,
      cursor: input.cursor,
      sort: input.sort,
      includeSnippets: true,
      acl,
      searchIndex,
    }),
    countSearchMatchesByType({
      knex,
      tenant,
      query: input.query,
      allowedTypes,
      acl,
      searchIndex,
    }),
  ]);

  const visibleHits = await verifyResultVisibility(knex, acl, hits);
  const pageHits = visibleHits.slice(0, limit);
  const groups = emptyGroups();
  for (const [type, count] of Object.entries(typeCounts) as Array<[SearchObjectType, number]>) {
    groups[type] = count;
  }
  const totalCount = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);

  const lastHit = pageHits[pageHits.length - 1];
  const result: SearchAppResult = {
    results: pageHits.map(toSearchResultRow),
    groups,
    totalCount,
    nextCursor: visibleHits.length > limit && lastHit ? encodeSearchCursor(lastHit) : undefined,
  };

  return searchAppResultSchema.parse(result) as SearchAppResult;
}
