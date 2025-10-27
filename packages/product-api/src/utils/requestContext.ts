/**
 * Request Context Utilities
 * Provides helper functions for managing request context in API routes
 */

import { NextRequest } from 'next/server';
import { ApiContext, ApiRequest } from '@product/api/middleware/apiMiddleware';

/**
 * Get the request context from a NextRequest
 * @param req - The Next.js request object
 * @returns The API context if available
 */
export function getRequestContext(req: NextRequest | ApiRequest): ApiContext | undefined {
  return (req as ApiRequest).context;
}

/**
 * Set the request context on a NextRequest
 * @param req - The Next.js request object
 * @param context - The API context to set
 */
export function setRequestContext(req: NextRequest, context: ApiContext): void {
  (req as ApiRequest).context = context;
}

/**
 * Ensure the request has a valid context
 * @param req - The Next.js request object
 * @throws Error if context is not available
 */
export function requireRequestContext(req: NextRequest | ApiRequest): ApiContext {
  const context = getRequestContext(req);
  if (!context) {
    throw new Error('Request context not available');
  }
  return context;
}