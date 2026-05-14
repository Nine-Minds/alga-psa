'use server';

import { withAuth } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';

import { registeredObjectTypes } from '../search';
import {
  resolveSearchAclPrincipal,
  verifyResultVisibility,
} from '../search/acl';
import {
  encodeSearchCursor,
  runSearchQuery,
  runSearchTypeaheadQuery,
} from '../search/query';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '../search/types';

const searchObjectTypeSchema = z.enum(SEARCH_OBJECT_TYPES);

export const searchAppInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  types: z.array(searchObjectTypeSchema).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  sort: z.enum(['relevance', 'recent']).optional(),
});

export type SearchAppInput = z.infer<typeof searchAppInputSchema>;

const searchResultRowSchema = z.object({
  type: searchObjectTypeSchema,
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  snippet: z.string().optional(),
  url: z.string().min(1),
  score: z.number(),
  updatedAt: z.string().datetime(),
});

const searchGroupsSchema = z.object(
  Object.fromEntries(
    SEARCH_OBJECT_TYPES.map((type) => [type, z.number().int().min(0)]),
  ),
);

export const searchAppResultSchema = z.object({
  results: z.array(searchResultRowSchema),
  groups: searchGroupsSchema,
  totalCount: z.number().int().min(0),
  nextCursor: z.string().min(1).optional(),
});

export const searchTypeaheadResultSchema = z.object({
  results: z.array(searchResultRowSchema),
  totalCount: z.number().int().min(0),
});

export interface SearchResultRow {
  type: SearchObjectType;
  id: string;
  parentId?: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  url: string;
  score: number;
  updatedAt: string;
}

export interface SearchAppResult {
  results: SearchResultRow[];
  groups: Record<SearchObjectType, number>;
  totalCount: number;
  nextCursor?: string;
}

export interface SearchTypeaheadResult {
  results: SearchResultRow[];
  totalCount: number;
}

const SEARCH_OBJECT_TYPE_SET = new Set<string>(SEARCH_OBJECT_TYPES);
const fullSearchLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
const typeaheadSearchLimiter = new RateLimiterMemory({ points: 30, duration: 1 });
const TYPE_REQUIRED_PERMISSION: Record<SearchObjectType, string> = {
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
};

export class SearchRateLimitError extends Error {
  public readonly code = 'SEARCH_RATE_LIMITED';
  public readonly status = 429;

  constructor(public readonly retryAfterMs?: number) {
    super('Search rate limit exceeded');
    this.name = 'SearchRateLimitError';
  }
}

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
  return types.filter((type) => permissionSet.has(TYPE_REQUIRED_PERMISSION[type]));
}

function emptyGroups(): Record<SearchObjectType, number> {
  return Object.fromEntries(
    SEARCH_OBJECT_TYPES.map((type) => [type, 0]),
  ) as Record<SearchObjectType, number>;
}

async function resolveAccessibleClientIds(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  user: IUserWithRoles,
): Promise<string[]> {
  if (user.user_type === 'client') {
    return user.clientId ? [user.clientId] : [];
  }

  const rows = await knex<{ client_id: string }>('clients')
    .select('client_id')
    .where('tenant', tenant);
  return rows.map((row) => row.client_id);
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
    const accessibleClientIds = await resolveAccessibleClientIds(knex, tenant, user);
    const acl = await resolveSearchAclPrincipal(knex, user, accessibleClientIds);
    const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

    const hits = await runSearchQuery({
      knex,
      tenant,
      query: parsedInput.query,
      allowedTypes,
      limit: limit + 1,
      cursor: parsedInput.cursor,
      sort: parsedInput.sort,
      includeSnippets: true,
      acl,
    });

    const visibleHits = await verifyResultVisibility(knex, acl, hits);
    const pageHits = visibleHits.slice(0, limit);
    const groups = emptyGroups();
    for (const hit of visibleHits) {
      groups[hit.type] += 1;
    }

    const lastHit = pageHits[pageHits.length - 1];
    const result: SearchAppResult = {
      results: pageHits.map(toSearchResultRow),
      groups,
      totalCount: visibleHits.length,
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
    const accessibleClientIds = await resolveAccessibleClientIds(knex, tenant, user);
    const acl = await resolveSearchAclPrincipal(knex, user, accessibleClientIds);
    const allowedTypes = filterTypesByPermission(requestedTypes, acl.permissions);

    const hits = await runSearchTypeaheadQuery({
      knex,
      tenant,
      query: parsedInput.query,
      allowedTypes,
      cursor: parsedInput.cursor,
      acl,
    });

    const visibleHits = await verifyResultVisibility(knex, acl, hits);
    const result: SearchTypeaheadResult = {
      results: visibleHits.slice(0, 5).map((hit) => ({
        ...toSearchResultRow(hit),
        snippet: undefined,
      })),
      totalCount: visibleHits.length,
    };

    if (result.totalCount === 0) {
      emitSearchTelemetry('search.query.empty', {
        variant: 'typeahead',
        tenant,
        userId: user.user_id,
      });
    }

    return searchTypeaheadResultSchema.parse(result);
  } finally {
    emitSearchTelemetry('search.query.latency_ms', {
      variant: 'typeahead',
      tenant,
      userId: user.user_id,
      value: Date.now() - startedAt,
    });
  }
});
