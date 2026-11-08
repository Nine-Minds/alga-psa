'use server';

import { withAuth } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { withProjectSearchAccess } from '@alga-psa/search/projectSearchAccess';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import {
  resolveSearchAclPrincipal,
  verifyResultVisibility,
} from '@alga-psa/search/acl';
import {
  countSearchMatches,
  runSearchTypeaheadQuery,
} from '@alga-psa/search/query';
import {
  filterTypesByPermission,
  resolveAllowedTypes,
  resolveClientAccess,
  runAppSearch,
  toSearchResultRow,
} from '@alga-psa/search/runAppSearch';
import {
  SearchRateLimitError,
  searchAppInputSchema,
  searchTypeaheadResultSchema,
  type SearchAppInput,
  type SearchAppResult,
  type SearchTypeaheadResult,
} from '@alga-psa/search/actions/searchActionShared';

export type {
  SearchAppInput,
  SearchAppResult,
  SearchResultRow,
  SearchTypeaheadResult,
} from '@alga-psa/search/actions/searchActionShared';

async function coManagedSearchAuthentication(user: { user_id: string; user_type?: string }, tenant: string) {
  // Only reached when the co-managed capability serves this tenant.
  const actor = await coManagedBrowserActor(user, tenant);
  return { kind: 'session' as const, sessionId: actor.sessionId };
}

const fullSearchLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
const typeaheadSearchLimiter = new RateLimiterMemory({ points: 30, duration: 1 });

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
    const result = await withProjectSearchAccess(knex, tenant, user, () => coManagedSearchAuthentication(user, tenant),
      (accessKnex, searchIndex) => runAppSearch(accessKnex, tenant, user, parsedInput, searchIndex));

    if (result.totalCount === 0) {
      emitSearchTelemetry('search.query.empty', {
        variant: 'full',
        tenant,
        userId: user.user_id,
      });
    }

    return result;
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
    const { visibleHits, totalCount } = await withProjectSearchAccess(knex, tenant, user, () => coManagedSearchAuthentication(user, tenant), async (accessKnex, searchIndex) => {
      const requestedTypes = resolveAllowedTypes(parsedInput.types);
      const clientAccess = resolveClientAccess(user);
      const acl = await resolveSearchAclPrincipal(accessKnex, user, clientAccess);
      const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

      // Typeahead and its count read the same admitted relation as the full search.
      const [hits, count] = await Promise.all([
        runSearchTypeaheadQuery({ knex: accessKnex, tenant, query: parsedInput.query, allowedTypes, cursor: parsedInput.cursor, acl, searchIndex }),
        countSearchMatches({ knex: accessKnex, tenant, query: parsedInput.query, allowedTypes, acl, searchIndex }),
      ]);
      return { visibleHits: await verifyResultVisibility(accessKnex, acl, hits), totalCount: count };
    });
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
