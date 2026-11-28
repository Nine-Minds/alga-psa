import type { ProductCode } from '@alga-psa/types';

/**
 * Principal kinds of the product surface, as data.
 *
 * The product surface registry answers "what may this tenant's product reach". A principal is the tenant's
 * product plus the kind of user asking. An ordinary MSP user has no kind and the product alone decides. A
 * user of a registered kind (today the co-managed seat technician) sees only what the kind lists: whatever
 * it does not list is closed, so a route or action added later is closed to the kind until a
 * rule here names it.
 *
 * A kind is keyed by the id its owning package declares on its built-in rule resolver
 * (`BuiltinRuleResolver.principalKind`), so the registry holds the surface and never imports the package.
 * This module is pure data and pure predicates: the sidebar, the route guard, the server-action guards and the
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
  /** Match the prefixes themselves only: a sub-path (and a query string, which is never part of the route) does not widen the rule. */
  exact?: boolean;
}

export interface SurfaceKind {
  /** MSP application routes (and the portal routes the kind may enter), first match wins. */
  routes: readonly SurfacePathRule[];
  /** Server-action product capabilities (the `capability` argument of the product guards) the kind reaches. */
  capabilities: readonly string[];
  /**
   * Where the kind's user lands when the application sends it "home" (sign-in, `/`, `/msp`, the logo). Must be a
   * route the kind opens. Absent: the kind has no home, and the MSP home answers not found like any closed route.
   */
  home?: string;
  /**
   * The sections of the self-profile page (`/msp/profile`) the kind may use: tab ids, plus
   * `dashboard-onboarding` for the onboarding preference. Absent: the kind has no profile page. Ordinary
   * principals have no kind and see every section their product and edition offer.
   */
  profileSections?: readonly string[];
  /**
   * REST requests the kind's own API keys may make (`principalApiKeyPrefix`), first match wins; anything no rule
   * opens is closed. Absent: the kind has no API surface. Only open an endpoint whose reads and writes the
   * kind's authorization rules already narrow: RBAC alone does not scope a record to the kind.
   */
  api?: readonly SurfaceApiRule[];
}

export type SurfaceApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SurfaceApiRule {
  group: string;
  /** Path patterns: `*` matches one segment, `**` as the last segment matches the rest (zero segments or more). */
  paths: readonly string[];
  methods: readonly SurfaceApiMethod[];
  access: 'open' | 'closed';
}

/**
 * The paths the application means as "home": sign-in's default callback, the root redirect, `/msp` and the
 * logo all send a user to the MSP dashboard. For a principal kind these resolve to the kind's own home.
 */
export const MSP_HOME_PATHS: readonly string[] = ['/msp', '/msp/dashboard'];

export const CO_MANAGED_SEAT_SURFACE = 'co_managed_seat';

/** What a principal kind that is not registered gets: nothing. Unknown means closed. */
const CLOSED_SURFACE: SurfaceKind = Object.freeze({ routes: [], capabilities: [] });

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
      // A technician's own details. Exact: no sub-path of the profile route opens.
      { group: 'seat_self_profile', access: 'open', exact: true, staticPrefixes: ['/msp/profile'] },
    ],
    capabilities: ['scheduling_time_actions'],
    home: '/msp/tickets',
    // Own details, sign-in security, notifications and shortcuts. No API Keys (a seat holds no general credential),
    // no SSO or calendar linking, and no dashboard onboarding preference (the seat has no dashboard).
    profileSections: ['profile', 'security', 'notifications', 'keyboard-shortcuts'],
    // The mobile app's operational screens. Each endpoint opened here was traced to the seat rules narrowing its
    // reads and writes; the static siblings of a wildcard are closed first because `*` would match them.
    api: [
      {
        group: 'seat_api_closed_siblings',
        access: 'closed',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        paths: [
          '/api/v1/tickets/search', '/api/v1/tickets/recurring/**', '/api/v1/tickets/templates/**',
          '/api/v1/tickets/by-external-link/**', '/api/v1/tickets/from-asset',
          '/api/v1/projects/export', '/api/v1/projects/search', '/api/v1/projects/stats', '/api/v1/projects/tasks',
          '/api/v1/assets/export', '/api/v1/assets/search', '/api/v1/assets/stats', '/api/v1/assets/documents',
          '/api/v1/assets/maintenance', '/api/v1/assets/relationships',
          '/api/v1/contacts/export', '/api/v1/contacts/search', '/api/v1/contacts/stats',
        ],
      },
      {
        group: 'seat_api_tickets',
        access: 'open',
        methods: ['GET'],
        paths: [
          '/api/v1/tickets', '/api/v1/tickets/stats', '/api/v1/tickets/statuses', '/api/v1/tickets/priorities',
          '/api/v1/tickets/categories',
          '/api/v1/tickets/*', '/api/v1/tickets/*/comments', '/api/v1/tickets/*/checklist', '/api/v1/tickets/*/documents',
          '/api/v1/tickets/*/time-entries', '/api/v1/tickets/*/assets', '/api/v1/tickets/*/bundle',
          '/api/v1/statuses', '/api/v1/priorities', '/api/v1/boards', '/api/v1/asset-statuses',
        ],
      },
      {
        group: 'seat_api_ticket_writes',
        access: 'open',
        methods: ['POST'],
        paths: [
          '/api/v1/tickets', '/api/v1/tickets/*/comments', '/api/v1/tickets/*/comments/*/reactions',
          '/api/v1/tickets/*/checklist', '/api/v1/tickets/*/documents',
        ],
      },
      {
        group: 'seat_api_ticket_updates',
        access: 'open',
        methods: ['PUT', 'PATCH'],
        paths: [
          '/api/v1/tickets/*', '/api/v1/tickets/*/status', '/api/v1/tickets/*/assignment',
          '/api/v1/tickets/*/comments/*', '/api/v1/tickets/*/checklist/*',
        ],
      },
      {
        group: 'seat_api_projects',
        access: 'open',
        methods: ['GET'],
        paths: [
          '/api/v1/projects', '/api/v1/projects/*', '/api/v1/projects/*/phases', '/api/v1/projects/*/phases/*/tasks',
          '/api/v1/projects/*/tasks', '/api/v1/projects/*/task-status-mappings', '/api/v1/projects/tasks/*',
          '/api/v1/projects/tasks/*/checklist', '/api/v1/projects/tasks/*/comments',
        ],
      },
      {
        group: 'seat_api_project_task_comments',
        access: 'open',
        methods: ['POST', 'PUT', 'DELETE'],
        paths: ['/api/v1/projects/tasks/*/comments', '/api/v1/projects/tasks/*/comments/*', '/api/v1/projects/tasks/*/comments/*/reactions'],
      },
      {
        group: 'seat_api_assets',
        access: 'open',
        methods: ['GET'],
        paths: [
          '/api/v1/assets', '/api/v1/assets/*', '/api/v1/assets/*/history', '/api/v1/assets/*/notes',
          '/api/v1/assets/*/software', '/api/v1/assets/*/tickets',
        ],
      },
      {
        group: 'seat_api_contacts',
        access: 'open',
        methods: ['GET'],
        paths: ['/api/v1/contacts', '/api/v1/contacts/*', '/api/v1/clients/*/contacts'],
      },
      {
        // Own operational entries only (TimeEntryService narrows a seat's reads). Writes stay closed: REST time
        // writes do not yet carry the operational mode, and the stopwatch logs commercial time by design.
        group: 'seat_api_time',
        access: 'open',
        methods: ['GET'],
        paths: ['/api/v1/time-entries', '/api/v1/time-periods', '/api/v1/time-periods/current', '/api/v1/stopwatch/active'],
      },
      {
        group: 'seat_api_documents',
        access: 'open',
        methods: ['GET'],
        paths: ['/api/documents/view/*', '/api/documents/*/content', '/api/documents/*/download'],
      },
      {
        group: 'seat_api_mobile_session',
        access: 'open',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        paths: [
          '/api/v1/mobile/auth/refresh', '/api/v1/mobile/auth/revoke', '/api/v1/mobile/auth/capabilities',
          '/api/v1/mobile/me/capabilities', '/api/v1/mobile/push-token', '/api/v1/mobile/push-token/test',
          '/api/v1/mobile/moderation/mutes', '/api/v1/mobile/moderation/mutes/*', '/api/v1/mobile/moderation/report',
        ],
      },
    ],
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

function matchesRule(rule: SurfacePathRule, path: string): boolean {
  return rule.exact ? rule.staticPrefixes.includes(path) : matchesPrefix(path, rule.staticPrefixes);
}

function allowedByRules(rules: readonly SurfacePathRule[], path: string): boolean {
  const normalized = surfacePath(path);
  return rules.find((rule) => matchesRule(rule, normalized))?.access === 'open';
}

export function surfaceAllowsRoute(kind: string, pathname: string): boolean {
  return allowedByRules(surfaceKindRules(kind).routes, pathname);
}

/**
 * The kind's home when `pathname` is the application's home, else null: a principal kind asking for the MSP home
 * is sent to its own instead of a not-found page. Null for a kind without a home, or whose home it does not open.
 */
export function surfaceHomeRedirect(kind: string, pathname: string): string | null {
  const home = surfaceKindRules(kind).home;
  if (!home || !MSP_HOME_PATHS.includes(surfacePath(pathname))) return null;
  return surfaceAllowsRoute(kind, home) ? home : null;
}

/** Whether the kind may use a section of its self-profile page; a kind that lists none has none. */
export function surfaceAllowsProfileSection(kind: string, section: string): boolean {
  return (surfaceKindRules(kind).profileSections ?? []).includes(section);
}

export function surfaceAllowsCapability(kind: string, capability: string): boolean {
  return surfaceKindRules(kind).capabilities.includes(capability);
}

function apiPathMatches(pattern: string, path: string): boolean {
  const want = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '**' && i === want.length - 1) return true;
    if (i >= got.length || (want[i] !== '*' && want[i] !== got[i])) return false;
  }
  return got.length === want.length;
}

/** Whether a request carrying the kind's own API key may reach `method pathname`. */
export function surfaceAllowsApiRequest(kind: string, method: string, pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  const verb = method.toUpperCase();
  const rule = (surfaceKindRules(kind).api ?? []).find(
    (candidate) => (candidate.methods as readonly string[]).includes(verb)
      && candidate.paths.some((pattern) => apiPathMatches(pattern, path)),
  );
  return rule?.access === 'open';
}
