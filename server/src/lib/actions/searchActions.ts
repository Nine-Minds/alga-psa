'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
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
  const parsedInput = searchAppInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  const limit = normalizeLimit(parsedInput.limit);
  const allowedTypes = resolveAllowedTypes(parsedInput.types);
  const accessibleClientIds = await resolveAccessibleClientIds(knex, tenant, user);
  const acl = await resolveSearchAclPrincipal(knex, user, accessibleClientIds);

  const hits = await runSearchQuery({
    knex,
    tenant,
    query: parsedInput.query,
    allowedTypes,
    limit: limit + 1,
    cursor: parsedInput.cursor,
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

  return searchAppResultSchema.parse(result) as SearchAppResult;
});

export const searchAppTypeaheadAction = withAuth(async (
  user,
  { tenant },
  input: Pick<SearchAppInput, 'query' | 'types' | 'cursor'>,
): Promise<SearchTypeaheadResult> => {
  const parsedInput = searchAppInputSchema.pick({
    query: true,
    types: true,
    cursor: true,
  }).parse(input);
  const { knex } = await createTenantKnex();
  const allowedTypes = resolveAllowedTypes(parsedInput.types);
  const accessibleClientIds = await resolveAccessibleClientIds(knex, tenant, user);
  const acl = await resolveSearchAclPrincipal(knex, user, accessibleClientIds);

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

  return searchTypeaheadResultSchema.parse(result);
});
