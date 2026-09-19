/**
 * The ticket list's source scope, separated from native filter state.
 *
 * `/msp/tickets` is one destination with two data sources: the native MSP
 * ticket dashboard, and the qualified co-managed working/oversight queue. The
 * distinction has to survive a page reload, a shared link, a Back/Forward step
 * and a client-drawer entry, so it is encoded in the URL as a discriminated
 * scope rather than inferred from which filters happen to be present.
 *
 * This module is deliberately pure (no JSX, no server imports) so the
 * precedence rules — explicit qualified scope outranks remembered native board
 * state; malformed values do not silently widen authority; oversight has no
 * "This MSP" workspace — can be tested without mounting the dashboard. It
 * matches the shape of `boardTabs.ts`, `ticketViewSettings.ts` and
 * `ticketListUrlSync.ts`.
 *
 * URL contract (proposed names, implemented here):
 *
 *     /msp/tickets?queueView=working&workspace=all
 *     /msp/tickets?queueView=working&workspace=msp
 *     /msp/tickets?queueView=oversight&workspace=<owner-tenant-id>
 *
 * An ordinary `/msp/tickets` — with or without native filter params — has no
 * `queueView` and is therefore native. That is the compatibility rule: the
 * absence of the new parameter is the signal to keep the old behavior,
 * including remembered board and page-size preference restoration.
 */

import { TICKET_LIST_PATHNAME } from './ticketListUrlSync';

/** The list's per-view context. */
export type TicketQueueView = 'working' | 'oversight';

/** Qualified state filter. */
export type TicketQueueState = 'open' | 'closed' | 'all';

/** Qualified sort keys the combined reader actually supports. */
export type TicketQueueSort = 'updated' | 'created' | 'title' | 'number';

export type TicketQueueDirection = 'asc' | 'desc';

/**
 * Which owner workspaces a qualified view is narrowed to.
 *
 * - `all`: every workspace currently authorized for the view (never "all
 *   tenants" — the reader's authorization still bounds it).
 * - `msp`: the authenticated home workspace. Working queue only; it is
 *   workspace narrowing within Working queue, not a peer view.
 * - `{ tenant }`: one explicit owner workspace. Kept verbatim even if it later
 *   becomes unavailable, so the reader can surface an unavailable result and a
 *   reset instead of silently widening to `all`.
 */
export type TicketListWorkspace = 'all' | 'msp' | { tenant: string };

export type NativeTicketListScope = { kind: 'native' };
export type QualifiedTicketListScope = {
  kind: 'qualified';
  view: TicketQueueView;
  workspace: TicketListWorkspace;
};
export type TicketListScope = NativeTicketListScope | QualifiedTicketListScope;

/** Common presentation state shared by both sources. */
export interface TicketListPresentation {
  /** Authorized local client narrowing; a client-drawer context fixes it. */
  clientId?: string;
  searchQuery: string;
  page: number;
  pageSize: number;
  /** Qualified-only list state (native derives open/closed from statusId). */
  state: TicketQueueState;
  /** Qualified-only sort key. */
  sort: TicketQueueSort;
  /** Qualified-only sort direction. */
  direction: TicketQueueDirection;
}

export const TICKET_LIST_QUEUE_VIEW_PARAM = 'queueView';
export const TICKET_LIST_WORKSPACE_PARAM = 'workspace';
export const TICKET_LIST_STATE_PARAM = 'queueState';
export const TICKET_LIST_SORT_PARAM = 'queueSort';
export const TICKET_LIST_DIRECTION_PARAM = 'queueDirection';
export const TICKET_LIST_CLIENT_PARAM = 'clientId';
export const TICKET_LIST_SEARCH_PARAM = 'searchQuery';
export const TICKET_LIST_PAGE_PARAM = 'page';
export const TICKET_LIST_PAGE_SIZE_PARAM = 'pageSize';

export const TICKET_LIST_DEFAULT_PAGE = 1;
export const TICKET_LIST_DEFAULT_PAGE_SIZE = 10;
export const TICKET_LIST_MIN_PAGE_SIZE = 1;
export const TICKET_LIST_MAX_PAGE_SIZE = 100;
export const TICKET_LIST_MAX_SEARCH_LENGTH = 200;

export const NATIVE_TICKET_LIST_SCOPE: NativeTicketListScope = { kind: 'native' };

export const DEFAULT_TICKET_LIST_PRESENTATION: TicketListPresentation = {
  searchQuery: '',
  page: TICKET_LIST_DEFAULT_PAGE,
  pageSize: TICKET_LIST_DEFAULT_PAGE_SIZE,
  state: 'open',
  sort: 'updated',
  direction: 'desc',
};

const QUEUE_VIEWS: readonly TicketQueueView[] = ['working', 'oversight'];
const QUEUE_STATES: readonly TicketQueueState[] = ['open', 'closed', 'all'];
const QUEUE_SORTS: readonly TicketQueueSort[] = ['updated', 'created', 'title', 'number'];
const QUEUE_DIRECTIONS: readonly TicketQueueDirection[] = ['asc', 'desc'];

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

/**
 * A tenant id is a UUID. Kept local so this client-safe module never imports
 * the co-managed server barrel just to validate an id shape.
 */
function isWorkspaceTenantId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function firstNonEmpty(value: string | null): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isQueueView(value: string | undefined): value is TicketQueueView {
  return value !== undefined && (QUEUE_VIEWS as readonly string[]).includes(value);
}

export function isTicketQueueState(value: unknown): value is TicketQueueState {
  return typeof value === 'string' && (QUEUE_STATES as readonly string[]).includes(value);
}

export function isTicketQueueSort(value: unknown): value is TicketQueueSort {
  return typeof value === 'string' && (QUEUE_SORTS as readonly string[]).includes(value);
}

export function isTicketQueueDirection(value: unknown): value is TicketQueueDirection {
  return typeof value === 'string' && (QUEUE_DIRECTIONS as readonly string[]).includes(value);
}

export function isQualifiedTicketListScope(scope: TicketListScope): scope is QualifiedTicketListScope {
  return scope.kind === 'qualified';
}

/**
 * A workspace token as it appears in the URL. A tenant id round-trips as itself;
 * `all` and `msp` are the two reserved tokens.
 */
export function ticketListWorkspaceToken(workspace: TicketListWorkspace): string {
  return typeof workspace === 'object' ? workspace.tenant : workspace;
}

function parseWorkspace(view: TicketQueueView, raw: string | undefined): TicketListWorkspace {
  if (!raw || raw === 'all') {
    return 'all';
  }
  if (raw === 'msp') {
    // "This MSP" is not a valid oversight workspace. An explicit transition
    // away from This MSP must select All workspaces, not carry a scope that
    // does not exist there; normalizing here keeps that rule in one place.
    return view === 'working' ? 'msp' : 'all';
  }
  if (isWorkspaceTenantId(raw)) {
    return { tenant: raw.toLowerCase() };
  }
  // Unknown token: fall back to the authorized `all` rather than inventing a
  // workspace id. `all` is still bounded by the reader's authorization, so this
  // does not widen authority — it only declines to guess at malformed input.
  return 'all';
}

/** Parse a URL/search string into a discriminated list scope. */
export function parseTicketListScope(search: string | URLSearchParams): TicketListScope {
  const params = toSearchParams(search);
  const view = firstNonEmpty(params.get(TICKET_LIST_QUEUE_VIEW_PARAM));
  if (!isQueueView(view)) {
    return NATIVE_TICKET_LIST_SCOPE;
  }
  return {
    kind: 'qualified',
    view,
    workspace: parseWorkspace(view, firstNonEmpty(params.get(TICKET_LIST_WORKSPACE_PARAM))),
  };
}

/** True when a URL explicitly opts into the qualified source. */
export function hasExplicitQualifiedScope(search: string | URLSearchParams): boolean {
  return isQueueView(firstNonEmpty(toSearchParams(search).get(TICKET_LIST_QUEUE_VIEW_PARAM)));
}

/**
 * Normalize a page-size value into the reader's supported 1..100 range.
 *
 * A non-positive or unparseable value is not a small page — it is absent
 * intent, so it falls back to the caller's valid preference (or the native
 * default). Only a value above the reader's limit is clamped, because 100 is a
 * real page the reader can serve.
 */
export function normalizeTicketListPageSize(value: unknown, fallback = TICKET_LIST_DEFAULT_PAGE_SIZE): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < TICKET_LIST_MIN_PAGE_SIZE) {
    return fallback;
  }
  return Math.min(TICKET_LIST_MAX_PAGE_SIZE, Math.trunc(parsed));
}

/** Normalize a page number to a positive integer. */
export function normalizeTicketListPage(value: unknown, fallback = TICKET_LIST_DEFAULT_PAGE): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/** Read the common presentation parameters, applying defaults and limits. */
export function parseTicketListPresentation(
  search: string | URLSearchParams,
  fallback: Partial<TicketListPresentation> = {},
): TicketListPresentation {
  const params = toSearchParams(search);
  const state = firstNonEmpty(params.get(TICKET_LIST_STATE_PARAM));
  const sort = firstNonEmpty(params.get(TICKET_LIST_SORT_PARAM));
  const direction = firstNonEmpty(params.get(TICKET_LIST_DIRECTION_PARAM));
  const searchQuery = (params.get(TICKET_LIST_SEARCH_PARAM) ?? '').slice(0, TICKET_LIST_MAX_SEARCH_LENGTH);
  return {
    clientId: firstNonEmpty(params.get(TICKET_LIST_CLIENT_PARAM)) ?? fallback.clientId,
    searchQuery,
    page: normalizeTicketListPage(params.get(TICKET_LIST_PAGE_PARAM), fallback.page ?? TICKET_LIST_DEFAULT_PAGE),
    pageSize: normalizeTicketListPageSize(params.get(TICKET_LIST_PAGE_SIZE_PARAM), fallback.pageSize ?? TICKET_LIST_DEFAULT_PAGE_SIZE),
    state: isTicketQueueState(state) ? state : fallback.state ?? 'open',
    sort: isTicketQueueSort(sort) ? sort : fallback.sort ?? 'updated',
    direction: isTicketQueueDirection(direction) ? direction : fallback.direction ?? 'desc',
  };
}

export interface SerializeTicketListOptions {
  /**
   * Emit `clientId` as a common presentation parameter. It is omitted by default
   * so ordinary scope controls do not carry a stale global client narrowing
   * unless the caller means it.
   */
  includeClient?: boolean;
}

/** Serialize a qualified scope + presentation into a query string (no path). */
export function serializeTicketListQuery(
  scope: TicketListScope,
  presentation: Partial<TicketListPresentation> = {},
  options: SerializeTicketListOptions = {},
): string {
  if (scope.kind === 'native') {
    return '';
  }
  const params = new URLSearchParams();
  params.set(TICKET_LIST_QUEUE_VIEW_PARAM, scope.view);
  params.set(TICKET_LIST_WORKSPACE_PARAM, ticketListWorkspaceToken(scope.workspace));
  if (presentation.clientId && options.includeClient) {
    params.set(TICKET_LIST_CLIENT_PARAM, presentation.clientId);
  }
  if (presentation.searchQuery) {
    params.set(TICKET_LIST_SEARCH_PARAM, presentation.searchQuery);
  }
  if (presentation.state && presentation.state !== 'open') {
    params.set(TICKET_LIST_STATE_PARAM, presentation.state);
  }
  if (presentation.sort && presentation.sort !== 'updated') {
    params.set(TICKET_LIST_SORT_PARAM, presentation.sort);
  }
  if (presentation.direction && presentation.direction !== 'desc') {
    params.set(TICKET_LIST_DIRECTION_PARAM, presentation.direction);
  }
  const page = normalizeTicketListPage(presentation.page);
  const pageSize = normalizeTicketListPageSize(presentation.pageSize);
  if (page !== TICKET_LIST_DEFAULT_PAGE) {
    params.set(TICKET_LIST_PAGE_PARAM, String(page));
  }
  if (pageSize !== TICKET_LIST_DEFAULT_PAGE_SIZE) {
    params.set(TICKET_LIST_PAGE_SIZE_PARAM, String(pageSize));
  }
  return params.toString();
}

/** Serialize a scope + presentation into a full pathname+href. */
export function buildTicketListHref(
  scope: TicketListScope,
  presentation: Partial<TicketListPresentation> = {},
  options: SerializeTicketListOptions = {},
): string {
  const query = serializeTicketListQuery(scope, presentation, options);
  return query ? `${TICKET_LIST_PATHNAME}?${query}` : TICKET_LIST_PATHNAME;
}

/** Structural equality for two scopes, ignoring presentation. */
export function ticketListScopesEqual(a: TicketListScope, b: TicketListScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'native' || b.kind === 'native') return true;
  return a.view === b.view && ticketListWorkspaceToken(a.workspace) === ticketListWorkspaceToken(b.workspace);
}

/**
 * The scope produced by an explicit view switch. Moving This MSP → oversight
 * selects All workspaces explicitly (it cannot carry the home token over); any
 * explicit customer workspace is retained unchanged so the customer can be
 * followed between the two views.
 */
export function switchTicketListView(scope: QualifiedTicketListScope, view: TicketQueueView): QualifiedTicketListScope {
  return { kind: 'qualified', view, workspace: parseWorkspace(view, ticketListWorkspaceToken(scope.workspace)) };
}

/**
 * Reset supported qualified filters and pagination while retaining the
 * selected view/workspace. A global client narrowing may be cleared, but a
 * client-drawer context is fixed and must be passed back in.
 */
export function resetQualifiedTicketListPresentation(
  presentation: TicketListPresentation,
  options: { keepClient?: boolean } = {},
): TicketListPresentation {
  return {
    ...DEFAULT_TICKET_LIST_PRESENTATION,
    clientId: options.keepClient ? presentation.clientId : undefined,
  };
}
