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
  countSearchMatchesByType,
  encodeSearchCursor,
  runSearchQuery,
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
): Promise<SearchAppResult> {
  const limit = normalizeLimit(input.limit);
  const requestedTypes = resolveAllowedTypes(input.types);
  const clientAccess = resolveClientAccess(user);
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
    }),
    countSearchMatchesByType({
      knex,
      tenant,
      query: input.query,
      allowedTypes,
      acl,
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
