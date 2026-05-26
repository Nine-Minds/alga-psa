'use server';

import { withAuth } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { registeredObjectTypes } from '../search';
import {
  resolveSearchAclPrincipal,
  verifyResultVisibility,
  type ClientAccess,
} from '../search/acl';
import {
  countSearchMatches,
  countSearchMatchesByType,
  encodeSearchCursor,
  runSearchQuery,
  runSearchTypeaheadQuery,
} from '../search/query';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@alga-psa/types';
import {
  SearchRateLimitError,
  searchAppInputSchema,
  searchAppResultSchema,
  searchTypeaheadResultSchema,
  type SearchAppInput,
  type SearchAppResult,
  type SearchResultRow,
  type SearchTypeaheadResult,
} from './searchActionShared';

export type {
  SearchAppInput,
  SearchAppResult,
  SearchResultRow,
  SearchTypeaheadResult,
} from './searchActionShared';

const SEARCH_OBJECT_TYPE_SET = new Set<string>(SEARCH_OBJECT_TYPES);
const fullSearchLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
const typeaheadSearchLimiter = new RateLimiterMemory({ points: 30, duration: 1 });
// Coarse query-time gate: a type is queried only if the user holds at least
// one of these permissions. The precise per-row filter is the stored
// `required_permission` enforced by aclPredicateSql. Types whose rows can
// require different permissions (e.g. `status` spans ticket vs project
// statuses) list all of them so no class of user is wrongly excluded.
const TYPE_REQUIRED_PERMISSION: Record<SearchObjectType, string | readonly string[]> = {
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

function emitSearchTelemetry(
  metric: 'search.query.count' | 'search.query.empty' | 'search.query.latency_ms',
  payload: Record<string, unknown>,
): void {
  logger.info('[Search] metric', {
    metric,
    ...payload,
  });
}

async function enforceSearchRateLimit(
  variant: 'full' | 'typeahead',
  tenant: string,
  userId: string,
): Promise<void> {
  const limiter = variant === 'full' ? fullSearchLimiter : typeaheadSearchLimiter;
  try {
    await limiter.consume(`${tenant}:${userId}`);
  } catch (error) {
    const maybeRateLimit = error as { msBeforeNext?: number };
    throw new SearchRateLimitError(maybeRateLimit.msBeforeNext);
  }
}

function normalizeLimit(limit: number | undefined): number {
  const parsed = Number(limit ?? 30);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 100));
}

function resolveAllowedTypes(inputTypes: SearchObjectType[] | undefined): SearchObjectType[] {
  const registered = registeredObjectTypes()
    .filter((type): type is SearchObjectType => SEARCH_OBJECT_TYPE_SET.has(type));
  if (!inputTypes || inputTypes.length === 0) {
    return registered;
  }

  const requested = new Set(inputTypes);
  return registered.filter((type) => requested.has(type));
}

function filterTypesByPermission(
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

function emptyGroups(): Record<SearchObjectType, number> {
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
function resolveClientAccess(user: IUserWithRoles): ClientAccess {
  if (user.user_type === 'client') {
    return { mode: 'scoped', clientIds: user.clientId ? [user.clientId] : [] };
  }

  return { mode: 'all' };
}

function toSearchResultRow(hit: Awaited<ReturnType<typeof runSearchQuery>>[number]): SearchResultRow {
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

export const searchAppAction = withAuth(async (
  user,
  { tenant },
  input: SearchAppInput,
): Promise<SearchAppResult> => {
  const startedAt = Date.now();
  const parsedInput = searchAppInputSchema.parse(input);
  await enforceSearchRateLimit('full', tenant, user.user_id);
  emitSearchTelemetry('search.query.count', {
    variant: 'full',
    tenant,
    userId: user.user_id,
  });

  try {
    const { knex } = await createTenantKnex();
    const limit = normalizeLimit(parsedInput.limit);
    const requestedTypes = resolveAllowedTypes(parsedInput.types);
    const clientAccess = resolveClientAccess(user);
    const acl = await resolveSearchAclPrincipal(knex, user, clientAccess);
    const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

    const [hits, typeCounts] = await Promise.all([
      runSearchQuery({
        knex,
        tenant,
        query: parsedInput.query,
        allowedTypes,
        limit: limit + 1,
        cursor: parsedInput.cursor,
        sort: parsedInput.sort,
        includeSnippets: true,
        acl,
      }),
      countSearchMatchesByType({
        knex,
        tenant,
        query: parsedInput.query,
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

    if (result.totalCount === 0) {
      emitSearchTelemetry('search.query.empty', {
        variant: 'full',
        tenant,
        userId: user.user_id,
      });
    }

    return searchAppResultSchema.parse(result) as SearchAppResult;
  } finally {
    emitSearchTelemetry('search.query.latency_ms', {
      variant: 'full',
      tenant,
      userId: user.user_id,
      value: Date.now() - startedAt,
    });
  }
});

export const searchAppTypeaheadAction = withAuth(async (
  user,
  { tenant },
  input: Pick<SearchAppInput, 'query' | 'types' | 'cursor'>,
): Promise<SearchTypeaheadResult> => {
  const startedAt = Date.now();
  const parsedInput = searchAppInputSchema.pick({
    query: true,
    types: true,
    cursor: true,
  }).parse(input);
  await enforceSearchRateLimit('typeahead', tenant, user.user_id);
  emitSearchTelemetry('search.query.count', {
    variant: 'typeahead',
    tenant,
    userId: user.user_id,
  });

  try {
    const { knex } = await createTenantKnex();
    const requestedTypes = resolveAllowedTypes(parsedInput.types);
    const clientAccess = resolveClientAccess(user);
    const acl = await resolveSearchAclPrincipal(knex, user, clientAccess);
    const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

    const [hits, totalCount] = await Promise.all([
      runSearchTypeaheadQuery({
        knex,
        tenant,
        query: parsedInput.query,
        allowedTypes,
        cursor: parsedInput.cursor,
        acl,
      }),
      countSearchMatches({
        knex,
        tenant,
        query: parsedInput.query,
        allowedTypes,
        acl,
      }),
    ]);

    const visibleHits = await verifyResultVisibility(knex, acl, hits);
    const result: SearchTypeaheadResult = {
      results: visibleHits.slice(0, 5).map((hit) => ({
        ...toSearchResultRow(hit),
        snippet: undefined,
      })),
      totalCount,
    };

    if (result.totalCount === 0) {
      emitSearchTelemetry('search.query.empty', {
        variant: 'typeahead',
        tenant,
        userId: user.user_id,
      });
    }

    return searchTypeaheadResultSchema.parse(result) as SearchTypeaheadResult;
  } finally {
    emitSearchTelemetry('search.query.latency_ms', {
      variant: 'typeahead',
      tenant,
      userId: user.user_id,
      value: Date.now() - startedAt,
    });
  }
});
