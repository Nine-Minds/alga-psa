/**
 * API Response Utilities
 * Standardized response creation and error handling
 */

import { NextResponse } from 'next/server';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    version: string;
    [key: string]: any;
  };
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  _links?: Record<string, any>;
}

/**
 * Create a standardized success response
 */
export function createApiResponse<T = any>(
  data: T,
  status: number = 200,
  meta?: Record<string, any>
): NextResponse {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      ...meta
    }
  };

  return NextResponse.json(response, { status });
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  message: string,
  status: number = 400,
  code: string = 'ERROR',
  details?: any
): NextResponse {
  const response: ApiResponse = {
    success: false,
    error: {
      message,
      code,
      details
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  };

  return NextResponse.json(response, { status });
}

/**
 * Create a paginated response
 */
export function createPaginatedResponse<T = any>(
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
  status: number = 200
): NextResponse {
  const response: PaginatedResponse<T> = {
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit)
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  };

  return NextResponse.json(response, { status });
}

/**
 * Create a 404 Not Found response
 */
export function createNotFoundResponse(resource: string = 'Resource'): NextResponse {
  return createErrorResponse(
    `${resource} not found`,
    404,
    'NOT_FOUND'
  );
}

/**
 * Create a 401 Unauthorized response
 */
export function createUnauthorizedResponse(message: string = 'Authentication required'): NextResponse {
  return createErrorResponse(
    message,
    401,
    'UNAUTHORIZED'
  );
}

/**
 * Create a 403 Forbidden response
 */
export function createForbiddenResponse(message: string = 'Insufficient permissions'): NextResponse {
  return createErrorResponse(
    message,
    403,
    'FORBIDDEN'
  );
}

/**
 * Create a 422 Validation Error response
 */
export function createValidationErrorResponse(errors: any[]): NextResponse {
  return createErrorResponse(
    'Validation failed',
    422,
    'VALIDATION_ERROR',
    { errors }
  );
}

/**
 * Create a 500 Internal Server Error response
 */
export function createInternalErrorResponse(
  message: string = 'Internal server error',
  details?: any
): NextResponse {
  return createErrorResponse(
    message,
    500,
    'INTERNAL_ERROR',
    details
  );
}