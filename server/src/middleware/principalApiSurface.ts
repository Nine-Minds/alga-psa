/**
 * Holds a request carrying a principal kind's API key (a co-managed seat technician's mobile session key) to the
 * kind's API surface, before any route handler runs.
 *
 * It runs ahead of every skip list, because the routes that skip the edge API-key check (mobile auth, MCP,
 * document downloads, ...) validate keys themselves and would otherwise admit the key on a route the kind does
 * not open. The validators refuse such an owner's key without the prefix, so the prefix cannot be dropped.
 */
import { NextResponse } from 'next/server';
import { principalKindOfApiKey } from '@alga-psa/types';
import { surfaceAllowsApiRequest } from '@shared/services/productSurfaceKinds';

export const PRINCIPAL_API_ROUTE_CLOSED = 'PRINCIPAL_API_ROUTE_CLOSED';

function bearerToken(authorization: string | null): string | null {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
}

/** The kind of a principal API key the request carries in any header a route reads keys from, else null. */
export function principalKindOfRequest(headers: { get(name: string): string | null }): string | null {
  return principalKindOfApiKey(headers.get('x-api-key'))
    ?? principalKindOfApiKey(bearerToken(headers.get('authorization')));
}

/** A 403 when the request carries a principal key and its kind does not open the route, otherwise null. */
export function principalApiSurfaceResponse(request: {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/')) return null;
  const kind = principalKindOfRequest(request.headers);
  if (!kind || surfaceAllowsApiRequest(kind, request.method, request.nextUrl.pathname)) return null;
  return NextResponse.json(
    { error: { code: PRINCIPAL_API_ROUTE_CLOSED, message: 'This endpoint is not available for this account' } },
    { status: 403 },
  );
}
