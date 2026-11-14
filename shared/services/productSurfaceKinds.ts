import type { ProductCode } from '@alga-psa/types';

/**
 * Principal kinds of the product surface, as data.
 *
 * The product surface registry answers "what may this tenant's product reach". A principal is the tenant's
 * product plus the kind of user asking. An ordinary MSP user has no kind and the product alone decides. A
 * user of a registered kind (today the co-managed seat technician) sees only what the kind lists: whatever
 * it does not list is closed, so a route, API path or action added later is closed to the kind until a
 * rule here names it.
 *
 * A kind is keyed by the id its owning package declares on its built-in rule resolver
 * (`BuiltinRuleResolver.principalKind`), so the registry holds the surface and never imports the package.
 * This module is pure data and pure predicates: the sidebar, the route guard, the API guards and the
 * server-action guards all ask the same functions, in a client bundle or on the server.
 */

export interface ProductPrincipal {
  productCode: ProductCode;
  /** Id of the user's principal kind; absent or null for an ordinary principal. */
  surfaceKind?: string | null;
}

/** A tenant's product code, or a principal: every resolver accepts either, and a bare code is an ordinary principal. */
export type ProductPrincipalInput = ProductCode | ProductPrincipal;

export function toProductPrincipal(input: ProductPrincipalInput): ProductPrincipal {
  return typeof input === 'string' ? { productCode: input } : input;
}

export interface SurfacePathRule {
  group: string;
  staticPrefixes: readonly string[];
  /** First matching rule decides; a path no rule matches is closed. */
  access: 'open' | 'closed';
}

export interface SurfaceKind {
  /** MSP application routes (and the portal routes the kind may enter), first match wins. */
  routes: readonly SurfacePathRule[];
  /** Session-authenticated app-internal API paths. REST under an API key is refused for a principal kind outright. */
  apis: readonly SurfacePathRule[];
  /** Server-action product capabilities (the `capability` argument of the product guards) the kind reaches. */
  capabilities: readonly string[];
}

export const CO_MANAGED_SEAT_SURFACE = 'co_managed_seat';

/** What a principal kind that is not registered gets: nothing. Unknown means closed. */
const CLOSED_SURFACE: SurfaceKind = Object.freeze({ routes: [], apis: [], capabilities: [] });

export const SURFACE_KINDS: Readonly<Record<string, SurfaceKind>> = Object.freeze({
  /**
   * A client's technician working a co-managed seat: tickets, projects, devices, documents and time.
   * Everything else, including billing, settings, user administration, dispatch, reports and the
   * co-managed administration, is closed.
   */
  [CO_MANAGED_SEAT_SURFACE]: {
    routes: [
      // Inside an operational prefix but MSP-run configuration or queues: closed ahead of the prefix.
      {
        group: 'seat_closed_within_operational',
        access: 'closed',
        staticPrefixes: [
          '/msp/tickets/customer',
          '/msp/tickets/recurring',
          '/msp/tickets/templates',
          '/msp/projects/templates',
          '/msp/assets/new',
          '/msp/assets/maintenance',
          '/msp/assets/custody',
          '/msp/assets/audits',
          '/msp/assets/automation',
          '/msp/assets/imports',
          '/msp/assets/integrations',
          '/msp/assets/policies',
        ],
      },
      { group: 'seat_tickets', access: 'open', staticPrefixes: ['/msp/tickets'] },
      { group: 'seat_projects', access: 'open', staticPrefixes: ['/msp/projects'] },
      { group: 'seat_devices', access: 'open', staticPrefixes: ['/msp/assets'] },
      { group: 'seat_documents', access: 'open', staticPrefixes: ['/msp/documents'] },
      { group: 'seat_time', access: 'open', staticPrefixes: ['/msp/time-entry'] },
    ],
    apis: [
      { group: 'seat_app_internal', access: 'open', staticPrefixes: ['/api/smart-search', '/api/notifications', '/api/v1/capabilities'] },
    ],
    capabilities: ['scheduling_time_actions'],
  },
});

/** The surface of a kind; a kind nobody registered is closed rather than open. */
export function surfaceKindRules(kind: string): SurfaceKind {
  return Object.prototype.hasOwnProperty.call(SURFACE_KINDS, kind) ? SURFACE_KINDS[kind] : CLOSED_SURFACE;
}

/** Path as matched for a kind: `/desk/` is the MSP shell, and a query string or fragment is not part of the route. */
function surfacePath(path: string): string {
  const bare = path.split(/[?#]/)[0];
  if (bare === '/desk') return '/msp';
  return bare.startsWith('/desk/') ? bare.replace('/desk/', '/msp/') : bare;
}

function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function allowedByRules(rules: readonly SurfacePathRule[], path: string): boolean {
  const normalized = surfacePath(path);
  return rules.find((rule) => matchesPrefix(normalized, rule.staticPrefixes))?.access === 'open';
}

export function surfaceAllowsRoute(kind: string, pathname: string): boolean {
  return allowedByRules(surfaceKindRules(kind).routes, pathname);
}

export function surfaceAllowsApi(kind: string, path: string): boolean {
  return allowedByRules(surfaceKindRules(kind).apis, path);
}

export function surfaceAllowsCapability(kind: string, capability: string): boolean {
  return surfaceKindRules(kind).capabilities.includes(capability);
}
