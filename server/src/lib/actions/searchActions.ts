'use server';

import { withAuth, getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { runAppSearch, runAppTypeaheadSearch, type SearchAuthentication } from '@alga-psa/search/runAppSearch';
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

// LEVERAGE: pattern co-managed-browser-identity — bind the tracked home session and reject API impersonation context.
async function searchAuthentication(user: { user_id: string }, tenant: string): Promise<SearchAuthentication | undefined> {
  const session = await getSession();
  if (getApiKeyUserOverride() || session?.user?.id !== user.user_id || session?.user?.tenant !== tenant || !session.session_id) return undefined;
  return { kind: 'session', sessionId: session.session_id };
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
    const result = await runAppSearch(knex, tenant, user, parsedInput, await searchAuthentication(user, tenant));

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
    const result = await runAppTypeaheadSearch(knex, tenant, user, parsedInput, await searchAuthentication(user, tenant));

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
