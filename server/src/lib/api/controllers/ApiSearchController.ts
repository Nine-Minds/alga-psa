/**
 * API Search Controller
 *
 * Exposes the unified full-text search engine (`app_search_index`) over the
 * public REST API at `GET /api/v1/search`. Reuses the same ACL/permission
 * filtering as the in-app search via `runAppSearch`, so an API key only
 * surfaces records the underlying user is allowed to see. Any valid API key
 * may call this endpoint — there is no separate `search` permission gate; the
 * per-type and per-row ACL inside `runAppSearch` does the filtering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { SEARCH_OBJECT_TYPES, type IUserWithRoles } from '@alga-psa/types';

import { ApiBaseController } from './ApiBaseController';
import { ApiSearchService } from '../services/ApiSearchService';
import { runWithTenant } from '../../db';
import { getConnection } from '../../db/db';
import { createSuccessResponse, handleApiError } from '../middleware/apiMiddleware';
import { runAppSearch } from '@alga-psa/search/runAppSearch';

/**
 * Query-string schema for the GET endpoint. Mirrors `searchAppInputSchema`
 * but coerces the transport encoding of query params: `types` arrives as a
 * comma-separated string (`types=ticket,project`) and `limit` as a string.
 */
export const searchApiQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  types: z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? value.split(',').map((part) => part.trim()).filter(Boolean)
          : value,
      z.array(z.enum(SEARCH_OBJECT_TYPES)),
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  sort: z.enum(['relevance', 'recent']).optional(),
});

export class ApiSearchController extends ApiBaseController {
  constructor() {
    super(new ApiSearchService(), {
      resource: 'search',
    });
  }

  /**
   * GET /api/v1/search
   * Unified full-text search across all indexed business records.
   */
  search() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          const input = this.validateQuery(apiRequest, searchApiQuerySchema);
          const knex = await getConnection(apiRequest.context.tenant);
          const result = await runAppSearch(
            knex,
            apiRequest.context.tenant,
            apiRequest.context.user as IUserWithRoles,
            input,
          );
          return createSuccessResponse(result, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
