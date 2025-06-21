/**
 * Middleware Composition Utility
 * Provides functionality to compose multiple middleware functions together
 */

import { NextRequest, NextResponse } from 'next/server';

export type MiddlewareFunction = (request: NextRequest) => Promise<NextResponse> | NextResponse;
export type MiddlewareHandler = (next: MiddlewareFunction) => MiddlewareFunction;

/**
 * Compose multiple middleware handlers into a single handler
 */
export function compose(...handlers: MiddlewareHandler[]): MiddlewareHandler {
  return (next: MiddlewareFunction) => {
    return handlers.reduceRight(
      (composed, handler) => handler(composed),
      next
    );
  };
}

/**
 * Execute middleware chain with a final handler
 */
export function executeMiddleware(
  handlers: MiddlewareHandler[],
  finalHandler: MiddlewareFunction
): MiddlewareFunction {
  const composed = compose(...handlers);
  return composed(finalHandler);
}