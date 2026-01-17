/**
 * API Middleware Framework
 * Provides authentication, authorization, validation, and error handling for REST API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema, ZodError } from 'zod';
import { ApiKeyService } from '../../services/apiKeyService';
import { hasPermission } from '../../auth/rbac';
import { findUserById } from '../../actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { runAsSystem } from '../services/SystemContext';

export interface ApiContext {
  userId: string;
  tenant: string;
  user?: any;
  kind?: 'system' | 'user';
}

export interface ApiRequest extends NextRequest {
  context?: ApiContext;
  params?: any;
}

export interface AuthenticatedApiRequest extends NextRequest {
  context: ApiContext;
  params?: any;
}

export interface ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: any;
}

export class ValidationError extends Error implements ApiError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  details: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class UnauthorizedError extends Error implements ApiError {
  statusCode = 401;
  code = 'UNAUTHORIZED';

  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error implements ApiError {
  statusCode = 403;
  code = 'FORBIDDEN';

  constructor(message: string = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error implements ApiError {
  statusCode = 404;
  code = 'NOT_FOUND';

  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error implements ApiError {
  statusCode = 409;
  code = 'CONFLICT';

  constructor(message: string = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class BadRequestError extends Error implements ApiError {
  statusCode = 400;
  code = 'BAD_REQUEST';

  constructor(message: string = 'Bad request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * API key authentication with NM Store support.
 * - When `allowNmStore` is true and `x-api-key` equals `nm_store_api_key`,
 *   requires `x-tenant-id` (when `requireTenantForNmStore` is true) and sets a system context.
 * - Otherwise validates tenant-scoped API key and sets user context.
 */
export interface ApiKeyAuthOptions {
  allowNmStore?: boolean;
  requireTenantForNmStore?: boolean;
}

let CACHED_NM_STORE_KEY: string | null = null;
let LAST_NM_STORE_FETCH = 0;
const NM_STORE_CACHE_TTL_MS = 60_000; // 1 minute

async function getNmStoreApiKey(): Promise<string | null> {
  const now = Date.now();
  if (CACHED_NM_STORE_KEY && now - LAST_NM_STORE_FETCH < NM_STORE_CACHE_TTL_MS) {
    return CACHED_NM_STORE_KEY;
  }
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('nm_store_api_key');
    CACHED_NM_STORE_KEY = key || null;
    LAST_NM_STORE_FETCH = now;
    return CACHED_NM_STORE_KEY;
  } catch {
    return null;
  }
}

export function withApiKeyAuth(options: ApiKeyAuthOptions = {}) {
  const { allowNmStore = false, requireTenantForNmStore = true } = options;
  return function(handler: (req: ApiRequest) => Promise<NextResponse>) {
    return async (req: ApiRequest): Promise<NextResponse> => {
      try {
        const apiKey = req.headers.get('x-api-key');
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // NM Store global key path
        if (allowNmStore) {
          const nmKey = await getNmStoreApiKey();
          if (nmKey && apiKey === nmKey) {
            const tenantId = req.headers.get('x-tenant-id') || undefined;
            if (requireTenantForNmStore && !tenantId) {
              throw new BadRequestError('x-tenant-id header required for NM store key');
            }
            req.context = {
              userId: '00000000-0000-0000-0000-000000000000',
              tenant: tenantId as string,
              user: null,
              kind: 'system'
            };
            // Ensure system operations are allowed for downstream createSystemContext()
            return await runAsSystem('withApiKeyAuth.system', async () => handler(req));
          }
        }

        // Default tenant API key path
        const keyRecord = await ApiKeyService.validateApiKey(apiKey);
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }
        const user = await findUserById(keyRecord.user_id);
        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        req.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user,
          kind: 'user'
        };

        return await handler(req);
      } catch (error) {
        return handleApiError(error);
      }
    };
  };
}

/**
 * Authentication middleware - validates API key and sets user context
 */
export async function withAuth(handler: (req: ApiRequest) => Promise<NextResponse>) {
  return async (req: ApiRequest): Promise<NextResponse> => {
    try {
      const apiKey = req.headers.get('x-api-key');

      if (!apiKey) {
        throw new UnauthorizedError('API key required');
      }

      const keyRecord = await ApiKeyService.validateApiKey(apiKey);

      if (!keyRecord) {
        throw new UnauthorizedError('Invalid API key');
      }

      // Get full user details
      const user = await findUserById(keyRecord.user_id);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Set context
      req.context = {
        userId: keyRecord.user_id,
        tenant: keyRecord.tenant,
        user
      };

      return await handler(req);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

/**
 * Authorization middleware - checks RBAC permissions
 */
export function withPermission(resource: string, action: string) {
  return function(handler: (req: ApiRequest) => Promise<NextResponse>) {
    return async (req: ApiRequest): Promise<NextResponse> => {
      try {
        if (!req.context?.user) {
          throw new UnauthorizedError('User context required');
        }

        const hasAccess = await hasPermission(req.context.user, resource, action);
        if (!hasAccess) {
          throw new ForbiddenError(`Permission denied: Cannot ${action} ${resource}`);
        }

        return await handler(req);
      } catch (error) {
        return handleApiError(error);
      }
    };
  };
}

/**
 * Validation middleware - validates request body against Zod schema
 */
export function withValidation(schema: ZodSchema) {
  return function(handler: (req: ApiRequest, validatedData: any) => Promise<NextResponse>) {
    return async (req: ApiRequest): Promise<NextResponse> => {
      try {
        const body = await req.json().catch(() => ({}));
        const validatedData = schema.parse(body);

        return await handler(req, validatedData);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ValidationError('Validation failed', error.errors);
        }
        return handleApiError(error);
      }
    };
  };
}

/**
 * Query parameter validation middleware
 */
export function withQueryValidation(schema: ZodSchema) {
  return function(handler: (req: ApiRequest, validatedQuery: any) => Promise<NextResponse>) {
    return async (req: ApiRequest): Promise<NextResponse> => {
      try {
        const url = new URL(req.url);
        const query = Object.fromEntries(url.searchParams.entries());
        const validatedQuery = schema.parse(query);

        return await handler(req, validatedQuery);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ValidationError('Query validation failed', error.errors);
        }
        return handleApiError(error);
      }
    };
  };
}

/**
 * Error handling middleware
 */
export function handleApiError(error: any): NextResponse {
  console.error('API Error:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  if (error.statusCode && typeof error.statusCode === 'number') {
    return NextResponse.json({
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        details: error.details
      }
    }, { status: error.statusCode });
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.errors
      }
    }, { status: 400 });
  }

  // Handle database errors
  if (error.code === '23505') { // PostgreSQL unique violation
    return NextResponse.json({
      error: {
        code: 'CONFLICT',
        message: 'Resource already exists',
        details: error.detail
      }
    }, { status: 409 });
  }

  if (error.code === '23503') { // PostgreSQL foreign key violation
    return NextResponse.json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid reference',
        details: error.detail
      }
    }, { status: 400 });
  }

  // Default server error
  return NextResponse.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    }
  }, { status: 500 });
}

/**
 * Success response helper
 */
export function createSuccessResponse(data: any, status: number = 200, metadata?: any): NextResponse {
  // For 204 No Content, return empty response
  if (status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const response: any = { data };

  if (metadata) {
    response.meta = metadata;
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };

  // Add deprecation warning if metadata indicates deprecated endpoint
  if (metadata?.deprecated) {
    headers['X-API-Deprecated'] = 'true';
    headers['X-API-Deprecation-Message'] = metadata.deprecationMessage || 'This endpoint is deprecated';
    if (metadata.deprecationUrl) {
      headers['X-API-Deprecation-Url'] = metadata.deprecationUrl;
    }
  }

  return NextResponse.json(response, { status, headers });
}

/**
 * Paginated response helper
 */
export function createPaginatedResponse(
  data: any[],
  total: number,
  page: number,
  limit: number,
  metadata?: any
): NextResponse {
  const totalPages = Math.ceil(total / limit);

  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };

  // Add deprecation warning if metadata indicates deprecated endpoint
  if (metadata?.deprecated) {
    headers['X-API-Deprecated'] = 'true';
    headers['X-API-Deprecation-Message'] = metadata.deprecationMessage || 'This endpoint is deprecated';
    if (metadata.deprecationUrl) {
      headers['X-API-Deprecation-Url'] = metadata.deprecationUrl;
    }
  }

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    meta: metadata
  }, { headers });
}

/**
 * Transform client response to include deprecated client fields
 * This ensures backward compatibility during the client → client migration
 */
export function addDeprecatedClientFields(data: any): any {
  if (!data) return data;

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => addDeprecatedClientFields(item));
  }

  // Handle single object
  if (typeof data === 'object') {
    const transformed: any = { ...data };

    // Map client fields to client fields (deprecated)
    if ('client_id' in data) {
      transformed.client_id = data.client_id;
    }
    if ('client_name' in data) {
      transformed.client_name = data.client_name;
    }
    if ('client_type' in data) {
      // client_type is the same in both schemas, no change needed
    }

    // Handle nested locations
    if (data.locations && Array.isArray(data.locations)) {
      transformed.locations = data.locations.map((loc: any) => ({
        ...loc,
        client_id: loc.client_id
      }));
    }

    return transformed;
  }

  return data;
}

/**
 * Transform client request to client fields
 * This allows old API calls with client fields to work with new client schema
 */
export function transformClientToClientFields(data: any): any {
  if (!data) return data;

  const transformed: any = { ...data };

  // Map client fields to client fields
  if ('client_name' in data) {
    transformed.client_name = data.client_name;
    delete transformed.client_name;
  }
  if ('client_id' in data) {
    transformed.client_id = data.client_id;
    delete transformed.client_id;
  }

  return transformed;
}

/**
 * Compose multiple middleware functions
 */
export function compose(...middlewares: any[]) {
  return middlewares.reduce(
    (acc, middleware) => (handler: any) => middleware(acc(handler)),
    (handler: any) => handler
  );
}
