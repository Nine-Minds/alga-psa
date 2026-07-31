import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { IUserWithRoles } from '@alga-psa/types';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { authenticateApiKeyRequest } from 'server/src/lib/api/middleware/apiAuthMiddleware';

type StatusError = Error & { status?: number; statusCode?: number; details?: unknown };

/**
 * Run a workflow-surface route action with dual authentication: browser/MSP
 * tooling authenticates via the NextAuth session (the withAuth wrapper inside
 * the action resolves it), while API-key callers — notably the MCP connector
 * driving the workflow authoring loop — are validated here and the action
 * runs with the key's user as the effective identity.
 */
export async function runWorkflowV2RouteWithAuth<T>(req: NextRequest, fn: () => Promise<T>): Promise<T> {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return fn();
  }
  const apiRequest = await authenticateApiKeyRequest(req);
  const user = apiRequest.context!.user as unknown as IUserWithRoles;
  return runWithApiKeyUser(user, fn);
}

export function handleWorkflowV2ApiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 });
  }

  const err = error as StatusError;
  const status = typeof err.status === 'number'
    ? err.status
    : typeof err.statusCode === 'number'
      ? err.statusCode
      : undefined;
  const message = err instanceof Error ? err.message : 'Unexpected error';

  if (typeof status === 'number') {
    return NextResponse.json({ error: message, ...(err.details ? { details: err.details } : {}) }, { status });
  }

  if (
    message.toLowerCase().includes('unauthorized') ||
    message.toLowerCase().includes('not authenticated') ||
    (err instanceof Error && err.name === 'AuthenticationError')
  ) {
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (message.toLowerCase().includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }

  return NextResponse.json({ error: message, ...(err.details ? { details: err.details } : {}) }, { status: 500 });
}
