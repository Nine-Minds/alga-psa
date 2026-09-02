/**
 * Single source of truth for the 3CX HTTP surface. The route handlers, the
 * template renderer, the validator test and the emulator all import these, so
 * a route rename breaks the template validator instead of silently drifting
 * the rendered XML away from the routes.
 */

export const THREECX_API_BASE = '/api/telephony/3cx';

export const THREECX_ROUTE_SEGMENTS = {
  lookup: 'lookup',
  lookupByEmail: 'lookup-by-email',
  search: 'search',
  reportCall: 'report-call',
} as const;

export type ThreecxRouteKey = keyof typeof THREECX_ROUTE_SEGMENTS;

export const THREECX_QUERY_PARAMS = {
  number: 'number',
  email: 'email',
  q: 'q',
} as const;

/** Ordered list of the four route segments. */
export const THREECX_ROUTE_SEGMENT_LIST = [
  THREECX_ROUTE_SEGMENTS.lookup,
  THREECX_ROUTE_SEGMENTS.lookupByEmail,
  THREECX_ROUTE_SEGMENTS.search,
  THREECX_ROUTE_SEGMENTS.reportCall,
] as const;

/** Builds the tenant-scoped path for one route segment (no baseUrl). */
export function threecxRoutePath(tenantSlug: string, segment: string): string {
  return `${THREECX_API_BASE}/${tenantSlug}/${segment}`;
}

/** Builds the absolute URL for one route segment. */
export function threecxRouteUrl(baseUrl: string, tenantSlug: string, segment: string): string {
  return `${baseUrl.replace(/\/$/, '')}${threecxRoutePath(tenantSlug, segment)}`;
}
