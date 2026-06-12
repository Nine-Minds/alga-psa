import { z } from 'zod';

import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@alga-psa/types';

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

export class SearchRateLimitError extends Error {
  public readonly code = 'SEARCH_RATE_LIMITED';
  public readonly status = 429;

  constructor(public readonly retryAfterMs?: number) {
    super('Search rate limit exceeded');
    this.name = 'SearchRateLimitError';
  }
}
