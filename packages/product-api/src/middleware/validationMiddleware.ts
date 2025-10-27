/**
 * Validation Middleware
 * Handles request validation using Zod schemas
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@product/api/utils/response';

export type ValidationType = 'body' | 'query' | 'params';

/**
 * Create validation middleware for request data
 */
export function withValidation<T extends z.ZodSchema>(
  schema: T,
  type: ValidationType = 'body'
) {
  return function validationMiddleware(
    next: (request: NextRequest) => Promise<NextResponse>
  ) {
    return async function(request: NextRequest): Promise<NextResponse> {
      try {
        let data: any;

        switch (type) {
          case 'body':
            try {
              data = await request.json();
            } catch {
              return createErrorResponse(
                'Invalid JSON in request body',
                400,
                'INVALID_JSON'
              );
            }
            break;

          case 'query':
            const searchParams = request.nextUrl.searchParams;
            data = Object.fromEntries(searchParams.entries());
            break;

          case 'params':
            // Route params should be set by the route handler
            data = (request as any).routeParams || {};
            break;

          default:
            return createErrorResponse(
              'Invalid validation type',
              500,
              'INTERNAL_ERROR'
            );
        }

        // Validate the data against the schema
        const result = schema.safeParse(data);

        if (!result.success) {
          const errors = result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          }));

          return createErrorResponse(
            'Validation failed',
            400,
            'VALIDATION_ERROR',
            { errors }
          );
        }

        // Attach validated data to request
        switch (type) {
          case 'body':
            (request as any).validatedBody = result.data;
            break;
          case 'query':
            (request as any).validatedQuery = result.data;
            break;
          case 'params':
            (request as any).validatedParams = result.data;
            break;
        }

        return next(request);
      } catch (error) {
        console.error('Validation middleware error:', error);
        return createErrorResponse(
          'Validation failed',
          500,
          'INTERNAL_ERROR'
        );
      }
    };
  };
}

/**
 * Validate query parameters
 */
export function withQueryValidation<T extends z.ZodSchema>(schema: T) {
  return withValidation(schema, 'query');
}

/**
 * Validate route parameters
 */
export function withParamsValidation<T extends z.ZodSchema>(schema: T) {
  return withValidation(schema, 'params');
}

/**
 * Common validation schemas
 */
export const commonValidations = {
  uuid: z.string().uuid('Invalid UUID format'),
  paginationQuery: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(25),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).default('desc')
  })
};