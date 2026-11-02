import { Knex } from 'knex';
import { getAuthorizationKernel } from 'server/src/lib/authorization/kernel';
import {
  ASSET_RECORD_SOURCE,
  PROJECT_RECORD_SOURCE,
  QUOTE_RECORD_SOURCE,
  TICKET_RECORD_SOURCE,
  isRecordFieldReadable,
  projectRecordByRedactions,
  type RedactableRecordSource,
} from '@alga-psa/co-managed/recordProjection';
import { buildProjectRecordContext, buildQuoteRecordContext, buildTicketRecordContext } from './recordContexts';
import type {
  AuthorizationRecord,
  AuthorizationSubject,
} from '@alga-psa/authorization/kernel/contracts';

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => (typeof value === 'string' ? value : null))
    .filter((value): value is string => Boolean(value));
}

function normalizeIdArrayFromObjects(values: unknown, key: string): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (!value || typeof value !== 'object') {
        return null;
      }

      const candidate = (value as Record<string, unknown>)[key];
      return typeof candidate === 'string' ? candidate : null;
    })
    .filter((value): value is string => Boolean(value));
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildAuthorizationPrincipalSubject(
  user: any,
  apiKeyId?: string
): AuthorizationSubject {
  const roleIds = Array.from(
    new Set([
      ...normalizeIdArrayFromObjects(user?.roles, 'role_id'),
      ...normalizeStringArray(user?.role_ids),
    ])
  );

  const teamIds = Array.from(
    new Set([
      ...normalizeIdArrayFromObjects(user?.teams, 'team_id'),
      ...normalizeStringArray(user?.team_ids),
    ])
  );

  const managedUserIds = Array.from(
    new Set([
      ...normalizeStringArray(user?.managed_user_ids),
      ...normalizeStringArray(user?.managedUserIds),
    ])
  );

  const portfolioClientIds = Array.from(
    new Set([
      ...normalizeStringArray(user?.portfolio_client_ids),
      ...normalizeStringArray(user?.portfolioClientIds),
    ])
  );

  const subject: AuthorizationSubject = {
    tenant: user?.tenant ?? '',
    userId: typeof user?.user_id === 'string' ? user.user_id : '',
    // 'service' is mapped explicitly; only a missing/legacy type falls back to internal.
    userType: user?.user_type === 'client' ? 'client' : user?.user_type === 'service' ? 'service' : 'internal',
    roleIds,
    teamIds,
    managedUserIds,
    portfolioClientIds,
  };

  const normalizedClientId = normalizeOptionalString(user?.client_id) ?? normalizeOptionalString(user?.clientId);
  if (normalizedClientId !== undefined) {
    subject.clientId = normalizedClientId;
  }

  if (typeof apiKeyId === 'string' && apiKeyId.trim().length > 0) {
    subject.apiKeyId = apiKeyId;
  }

  return subject;
}

/**
 * Who is reading? One rule, applied in order, shared by every read-authorization path:
 *  1. `user` with a non-empty `user_id`, or a non-empty `apiKeyId`: the request principal, built exactly as before.
 *  2. Otherwise a non-empty `userId` (a `ServiceContext` used by direct service callers, which carries no `user`):
 *     the subject is `{ user_id: userId, tenant }` and the kernel loads that user's roles and bundles itself, so the
 *     real policy still applies.
 *  3. Otherwise there is no principal at all: an internal call with no identity is unrestricted, so the kernel is
 *     skipped (returns null). An empty-string user id must never reach the kernel.
 */
function resolveReadSubject(input: { tenant: string; user?: any; userId?: string; apiKeyId?: string }): AuthorizationSubject | null {
  const hasUser = typeof input.user?.user_id === 'string' && input.user.user_id.length > 0;
  const hasApiKey = typeof input.apiKeyId === 'string' && input.apiKeyId.trim().length > 0;
  let subject: AuthorizationSubject;
  if (hasUser || hasApiKey) {
    subject = buildAuthorizationPrincipalSubject(input.user, input.apiKeyId);
  } else if (typeof input.userId === 'string' && input.userId.length > 0) {
    subject = buildAuthorizationPrincipalSubject({ user_id: input.userId, tenant: input.tenant });
  } else {
    return null;
  }
  subject.tenant = input.tenant;
  return subject;
}

declare const authorizedProjectionBrand: unique symbol;
const projectionMark = Symbol('authorizedProjection');

/**
 * A record that has been through the authorization kernel AND the policy redaction projector. The only way to obtain
 * one is `projectApiResourceRead` / `projectApiResourceReads`; REST read paths accept and serialize this type, so a
 * raw `Record<string, any>` cannot be passed where a projection is expected.
 */
export type AuthorizedProjection<T = Record<string, any>> = Partial<T> & { readonly [authorizedProjectionBrand]: true };

const projectionRedactions = Symbol('authorizedProjectionRedactions');

/**
 * Projects another record owned by the same authorized resource (a mutation result, quote lines, ...) under the
 * decision that produced `projection`, so it is never re-authorized and never served unredacted. Returns null when the
 * redactions suppress the record under `source` (default: the projection's own record kind).
 */
export function reprojectUnderDecision<R extends Record<string, any>>(
  projection: AuthorizedProjection<any>,
  record: R,
  source: RedactableRecordSource,
): AuthorizedProjection<R> | null {
  const redactions: readonly string[] = (projection as any)[projectionRedactions] ?? [];
  const projected = projectRecordByRedactions(redactions, record, source);
  if (projected === null) return null;
  Object.defineProperty(projected, projectionMark, { value: true, enumerable: false });
  Object.defineProperty(projected, projectionRedactions, { value: redactions, enumerable: false });
  return projected as AuthorizedProjection<R>;
}

export function isAuthorizedProjection(value: unknown): value is AuthorizedProjection {
  return typeof value === 'object' && value !== null && (value as any)[projectionMark] === true;
}

/** Declarative per-kind table: kernel resource type, redaction descriptor and default record-context builder. */
const API_READ_KINDS = {
  project: { resource: 'project', source: PROJECT_RECORD_SOURCE, context: buildProjectRecordContext },
  ticket: { resource: 'ticket', source: TICKET_RECORD_SOURCE, context: buildTicketRecordContext },
  quote: { resource: 'billing', source: QUOTE_RECORD_SOURCE, context: buildQuoteRecordContext },
  asset: { resource: 'asset', source: ASSET_RECORD_SOURCE, context: undefined },
} as const;

export type ApiReadKind = keyof typeof API_READ_KINDS;

export interface ApiResourceReadInput<T extends Record<string, any>> {
  knex: Knex;
  tenant: string;
  user?: any;
  /** Direct service callers identify the principal by id only (see `resolveReadSubject`). */
  userId?: string;
  apiKeyId?: string;
  kind: ApiReadKind;
  /** The row to project (and serialize). */
  record: T;
  /** Authorization context when it is not derivable from `record` (assets). */
  recordContext?: AuthorizationRecord;
}

/**
 * Authorizes a read once and returns the redacted record, or null when access is denied or the row is suppressed
 * (hidden identifier / whole resource). Callers must not distinguish the two: both are "not found".
 */
export async function projectApiResourceRead<T extends Record<string, any>>(
  input: ApiResourceReadInput<T>
): Promise<AuthorizedProjection<T> | null> {
  const kind = API_READ_KINDS[input.kind];
  const recordContext = input.recordContext ?? kind.context?.(input.record);
  if (!recordContext) {
    throw new Error(`projectApiResourceRead: a recordContext is required for kind "${input.kind}"`);
  }

  const subject = resolveReadSubject(input);
  let redactedFields: readonly string[] = [];
  if (subject) {
    const kernel = await getAuthorizationKernel();
    const decision = await kernel.authorizeResource({
      knex: input.knex as any,
      subject,
      resource: { type: kind.resource, action: 'read' },
      record: recordContext,
    });
    if (!decision.allowed) {
      return null;
    }
    redactedFields = decision.redactedFields ?? [];
  }

  const projected = projectRecordByRedactions(redactedFields, input.record, kind.source);
  if (projected === null) {
    return null;
  }
  Object.defineProperty(projected, projectionMark, { value: true, enumerable: false });
  Object.defineProperty(projected, projectionRedactions, { value: redactedFields, enumerable: false });
  return projected as AuthorizedProjection<T>;
}

/** Batch form for list paths: projects every row, dropping denied/suppressed ones (order preserved). */
export async function projectApiResourceReads<T extends Record<string, any>>(
  input: Omit<ApiResourceReadInput<T>, 'record' | 'recordContext'> & { records: T[] }
): Promise<AuthorizedProjection<T>[]> {
  const { records, ...rest } = input;
  const projected = await Promise.all(records.map((record) => projectApiResourceRead<T>({ ...rest, record })));
  const rows: AuthorizedProjection<T>[] = [];
  for (const row of projected) {
    if (row !== null) rows.push(row);
  }
  return rows;
}

/**
 * The caller's field redactions for a resource kind, independent of any one row. Rows the kernel lets through are
 * never partially scoped: a bundle rule whose relationship template does not match DENIES the row (it is dropped by
 * the projector), and the rules that do match contribute their `redactedFields` unconditionally. So every row a
 * caller can see carries the union of all applicable redactions, and evaluating the decision without a record yields
 * exactly that union. This is approach (b): a column is unsearchable whenever any applicable rule redacts it.
 */
export async function resolveApiReadRedactions(input: {
  knex: Knex; tenant: string; user?: any; userId?: string; apiKeyId?: string; kind: ApiReadKind;
}): Promise<readonly string[]> {
  const subject = resolveReadSubject(input);
  if (!subject) return [];
  const kernel = await getAuthorizationKernel();
  const decision = await kernel.authorizeResource({
    knex: input.knex as any,
    subject,
    resource: { type: API_READ_KINDS[input.kind].resource, action: 'read' },
  });
  return decision.redactedFields ?? [];
}

export type PredicateColumn = string | { column: string; field: string };

/**
 * Policy-aware predicate builder for one request: which columns may a search/filter touch for this caller.
 * Every REST search or filter site composes with this instead of listing columns, so the exclusions are derived from
 * the same redactions and descriptors that shape the response.
 */
export interface PredicateGuard {
  /** True when the column's response field is readable for the caller. */
  readable(column: PredicateColumn): boolean;
  /** The readable subset of `columns` (as physical column strings). */
  columns(columns: readonly PredicateColumn[]): string[];
  /** `AND (c1 ILIKE term OR c2 ILIKE term ...)` over readable columns only; no readable column matches nothing. */
  search(query: Knex.QueryBuilder, columns: readonly PredicateColumn[], term: string): Knex.QueryBuilder;
  /**
   * Applies a filter on one column when it is readable; otherwise the filter matches nothing (a constant, so it
   * reveals nothing about the hidden value).
   */
  filter(query: Knex.QueryBuilder, column: PredicateColumn, apply: (q: Knex.QueryBuilder, column: string) => void): Knex.QueryBuilder;
}

const columnName = (c: PredicateColumn) => (typeof c === 'string' ? c : c.column);
const fieldName = (c: PredicateColumn) => (typeof c === 'string' ? c.slice(c.lastIndexOf('.') + 1) : c.field);

export function buildPredicateGuard(kind: ApiReadKind, redactions: readonly string[]): PredicateGuard {
  const source = API_READ_KINDS[kind].source;
  const readable = (c: PredicateColumn) => isRecordFieldReadable(redactions, source, fieldName(c));
  const guard: PredicateGuard = {
    readable,
    columns: (columns) => columns.filter(readable).map(columnName),
    search(query, columns, term) {
      const allowed = guard.columns(columns);
      if (allowed.length === 0) return query.whereRaw('1 = 0');
      return query.where(function (this: Knex.QueryBuilder) {
        for (const column of allowed) this.orWhere(column, 'ilike', `%${term}%`);
      });
    },
    filter(query, column, apply) {
      if (!readable(column)) return query.whereRaw('1 = 0');
      apply(query, columnName(column));
      return query;
    },
  };
  return guard;
}

/** Resolves the caller's redactions once and returns the guard for `kind`. `context` is a REST `ServiceContext`. */
export async function createPredicateGuard(
  knex: Knex,
  context: { tenant?: string; tenantId?: string; user?: any; userId?: string; apiKeyId?: string },
  kind: ApiReadKind,
): Promise<PredicateGuard> {
  const redactions = await resolveApiReadRedactions({
    knex, tenant: (context.tenant ?? context.tenantId) as string, user: context.user, userId: context.userId,
    apiKeyId: context.apiKeyId, kind,
  });
  return buildPredicateGuard(kind, redactions);
}
