import type { PredicateClause } from '@alga-psa/predicates';

/**
 * Stored ticket filters, version by version.
 *
 *   v1  legacy keys only (`tags` holds ticket tag TEXT; PR #3858's `requester_vip` / `client_vip`).
 *   v2  legacy keys plus `where`, a flat `and` group of predicate clauses on the ticket query schema.
 *   v3  the single `clientId` key is folded into `where` as a `client.id in [id]` clause.
 *
 * The same pure function migrates named views (schema_version on the row), board default views and
 * the tenant default view (a `schemaVersion` field inside the stored document).
 */
export const TICKET_FILTERS_SCHEMA_VERSION = 3;

/**
 * Renamed or removed predicate paths: `oldPath -> newPath`. A path is a persisted contract from its
 * first release, so a rename ships an entry here (see the add-a-dimension recipe in
 * packages/tickets/src/lib/ticketQuerySchema.ts). Empty until the first rename.
 */
export const TICKET_PATH_ALIASES: Readonly<Record<string, string>> = {};

/** Keys PR #3858 introduced and this plan removes. */
const REMOVED_V1_KEYS = ['requester_vip', 'client_vip', 'requesterVip', 'clientVip', 'requesterVipOnly', 'clientVipOnly'];

export interface TicketFilterMigrationContext {
  /**
   * Ticket tag definition ids by tag text. When absent, legacy `tags` text is left as it is: the
   * ticket-list codec still resolves it at query time, so nothing is lost.
   */
  tagIdsByText?: ReadonlyMap<string, string>;
}

/** Applies the path alias map to a stored `where`. Unknown shapes pass through untouched. */
export function applyTicketPathAliases(
  where: unknown,
  aliases: Readonly<Record<string, string>> = TICKET_PATH_ALIASES,
): unknown {
  if (!where || typeof where !== 'object' || !Array.isArray((where as { clauses?: unknown }).clauses)) return where;
  const group = where as { join?: unknown; clauses: unknown[] };
  return {
    ...group,
    clauses: group.clauses.map((clause) => {
      const path = (clause as Partial<PredicateClause> | null)?.path;
      return typeof path === 'string' && Object.prototype.hasOwnProperty.call(aliases, path)
        ? { ...(clause as object), path: aliases[path] }
        : clause;
    }),
  };
}

/** Legacy `tags` text values in a stored filters object (for pre-resolving ids). */
export function legacyTagTexts(filters: unknown): string[] {
  const tags = (filters as { tags?: unknown } | null | undefined)?.tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

const isClientRowClause = (clause: unknown): boolean => {
  const candidate = clause as Partial<PredicateClause> | null;
  return !!candidate && typeof candidate === 'object'
    && candidate.path === 'client.id' && (candidate.operator === 'in' || candidate.operator === 'not_in');
};

/**
 * Brings a stored filters object up to the current version (v3). Idempotent for v3 input.
 * A URL is a v2 filter document, so URL parsers call this with `fromVersion` 2 to fold a legacy
 * `?clientId=` the same way stored views do. Never throws on odd input:
 * unknown shapes are passed through for the read-side sanitizer to drop.
 */
export function migrateTicketFilters(
  filters: Record<string, unknown> | undefined,
  fromVersion: number,
  context: TicketFilterMigrationContext = {},
): Record<string, unknown> | undefined {
  if (!filters || typeof filters !== 'object') return filters;
  const out: Record<string, unknown> = { ...filters };

  if (fromVersion < 2) {
    for (const key of REMOVED_V1_KEYS) delete out[key];

    const texts = legacyTagTexts(out);
    // Without a context `tags` is deliberately kept as it is: nothing is widened, because the
    // ticket-list codec (ticketFiltersToPredicates) still resolves the text at query time and
    // an unknown text matches nothing there.
    if (texts.length > 0 && context.tagIdsByText) {
      const ids = Array.from(
        new Set(texts.map((text) => context.tagIdsByText!.get(text)).filter((id): id is string => !!id)),
      );
      delete out.tags;
      // When texts existed but none resolved, the clause is `in []`, which the predicates spec and
      // compiler define as matching nothing. Dropping it would widen the view to every ticket.
      const existing = (out.where as { clauses?: unknown[] } | undefined)?.clauses ?? [];
      out.where = {
        join: 'and',
        clauses: [...existing, { path: 'tags', operator: 'in', value: ids }],
      };
    }
  }

  if (out.where !== undefined) out.where = applyTicketPathAliases(out.where);

  if (fromVersion < 3 && typeof out.clientId === 'string') {
    const clientId = out.clientId;
    delete out.clientId;
    const where = out.where as { join?: unknown; clauses?: unknown } | undefined;
    const existing = Array.isArray(where?.clauses) ? (where!.clauses as unknown[]) : [];
    // An explicit client row wins over the legacy key (as `boardIds` wins over `boardId`).
    // An empty string never restricted the list, so it adds nothing.
    if (clientId && !existing.some(isClientRowClause)) {
      out.where = {
        ...(where && typeof where === 'object' ? where : {}),
        join: 'and',
        clauses: [...existing, { path: 'client.id', operator: 'in', value: [clientId] }],
      };
    }
  }
  return out;
}

/** Migrates a stored default-view document (board or tenant), reading its own version field. */
export function migrateTicketDefaultView(
  doc: Record<string, unknown>,
  context: TicketFilterMigrationContext = {},
): Record<string, unknown> {
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  const filters = doc.filters && typeof doc.filters === 'object' && !Array.isArray(doc.filters)
    ? migrateTicketFilters(doc.filters as Record<string, unknown>, version, context)
    : doc.filters;
  const { filters: _drop, ...rest } = doc;
  return { ...rest, ...(filters !== undefined ? { filters } : {}), schemaVersion: TICKET_FILTERS_SCHEMA_VERSION };
}
