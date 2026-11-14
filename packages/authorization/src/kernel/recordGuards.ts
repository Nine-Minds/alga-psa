import type { Knex } from 'knex';
import type { AuthorizationEvaluationInput, AuthorizationRecord } from './contracts';
import type { RelationshipSqlContext } from './relationshipTemplates';

// ---------------------------------------------------------------------------
// Record guards: conditions on a record's own attributes or on the records it is attached to.
//
// A relationship template answers "does this record belong to the subject's scope". A guard answers a
// question about the record itself: its audience, or the tickets a document is attached to. Like a template,
// each guard is defined ONCE with two facets, so the JS kernel and the SQL compiler cannot drift:
//   - matches(): evaluated against the record the kernel was given
//   - compileSql(): the same predicate, pushed into a list query through the resource's adapter
//
// Guards are carried by built-in resolver rules (`constraintKey`). They are not bundle constraints, so a
// bundle cannot name one and the bundle compiler never sees one.
//
// Both facets fail closed. A record that does not carry the attribute a guard reads fails the guard in JS,
// and a resource whose adapter does not map the attribute matches no row in SQL.
// ---------------------------------------------------------------------------

// LEVERAGE: friction client-visible-guard-outside-registry — `client_visible_only` is the same kind of guard (record attribute, JS + SQL
// facet) but is evaluated in bundleProvider, builtinResolverEvaluation and compileBundleRuleSql; it belongs in this registry.
export const RECORD_GUARD_KEYS = [
  /** The record's audience is `client` or `public`; an `internal` record is hidden. */
  'external_audience_only',
  /** Every ticket the record is attached to is one the rule's client and boards admit. Attached to none is fine. */
  'attached_tickets_in_scope',
  /** The record is marked client-visible, or it is attached to a ticket the rule's client and boards admit. */
  'client_visible_or_in_scope_ticket',
] as const;

export type RecordGuardKey = (typeof RECORD_GUARD_KEYS)[number];

export function isRecordGuardKey(value: unknown): value is RecordGuardKey {
  return typeof value === 'string' && (RECORD_GUARD_KEYS as readonly string[]).includes(value);
}

/** The audiences a seat technician and other external readers may see. */
export const EXTERNAL_AUDIENCES = ['client', 'public'] as const;

/** What a guard needs from the rule that carries it. */
export interface RecordGuardRule {
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
}

/** A ticket a record is attached to, as the kernel's record carries it (`record.attachedTickets`). */
export interface AttachedTicketRef {
  clientId: string | null;
  boardId: string | null;
}

/** The tickets a rule admits: its clients and boards must both hold. */
export interface TicketScope {
  clientIds: string[];
  boardIds: string[];
}

/** Which of a record's attached tickets must be in scope. */
export type AttachedTicketQuantifier = 'every' | 'some';

interface RecordGuardDef {
  matches(rule: RecordGuardRule, record: AuthorizationRecord): boolean;
  compileSql(builder: Knex.QueryBuilder, rule: RecordGuardRule, ctx: RelationshipSqlContext): void;
}

function deny(builder: Knex.QueryBuilder): void {
  builder.whereRaw('1 = 0');
}

function attachedTickets(record: AuthorizationRecord): AttachedTicketRef[] | null {
  const value = record.attachedTickets;
  if (!Array.isArray(value)) return null;
  return value.map((ticket) => {
    const candidate = (typeof ticket === 'object' && ticket !== null ? ticket : {}) as Record<string, unknown>;
    return {
      clientId: typeof candidate.clientId === 'string' ? candidate.clientId : null,
      boardId: typeof candidate.boardId === 'string' ? candidate.boardId : null,
    };
  });
}

function ticketInScope(ticket: AttachedTicketRef, scope: TicketScope): boolean {
  return Boolean(ticket.clientId && ticket.boardId &&
    scope.clientIds.includes(ticket.clientId) && scope.boardIds.includes(ticket.boardId));
}

function scopeOf(rule: RecordGuardRule): TicketScope {
  return { clientIds: rule.selectedClientIds ?? [], boardIds: rule.selectedBoardIds ?? [] };
}

function applyAttachedTickets(
  builder: Knex.QueryBuilder,
  rule: RecordGuardRule,
  ctx: RelationshipSqlContext,
  quantifier: AttachedTicketQuantifier
): void {
  if (!ctx.adapter.applyAttachedTickets) {
    deny(builder);
    return;
  }
  ctx.adapter.applyAttachedTickets(builder, scopeOf(rule), quantifier);
}

const RECORD_GUARDS: Record<RecordGuardKey, RecordGuardDef> = {
  external_audience_only: {
    matches: (_rule, record) =>
      typeof record.audience === 'string' && (EXTERNAL_AUDIENCES as readonly string[]).includes(record.audience),
    compileSql: (builder, _rule, ctx) => {
      if (!ctx.adapter.audienceColumn) {
        deny(builder);
        return;
      }
      builder.whereIn(ctx.adapter.audienceColumn, [...EXTERNAL_AUDIENCES]);
    },
  },
  attached_tickets_in_scope: {
    matches: (rule, record) => {
      const tickets = attachedTickets(record);
      if (!tickets) return false;
      const scope = scopeOf(rule);
      return tickets.every((ticket) => ticketInScope(ticket, scope));
    },
    compileSql: (builder, rule, ctx) => applyAttachedTickets(builder, rule, ctx, 'every'),
  },
  client_visible_or_in_scope_ticket: {
    matches: (rule, record) => {
      if (record.is_client_visible === true) return true;
      const scope = scopeOf(rule);
      return (attachedTickets(record) ?? []).some((ticket) => ticketInScope(ticket, scope));
    },
    compileSql: (builder, rule, ctx) => {
      builder.where(function visibleOrViaTicket(this: Knex.QueryBuilder) {
        if (ctx.adapter.clientVisibleColumn) this.where(ctx.adapter.clientVisibleColumn, true);
        else deny(this);
        this.orWhere(function viaTicket(this: Knex.QueryBuilder) {
          applyAttachedTickets(this, rule, ctx, 'some');
        });
      });
    },
  },
};

/** Whether the record passes the guard. Meant for a record the kernel was given; a record-less check is narrowed in SQL. */
export function evaluateRecordGuard(
  key: RecordGuardKey,
  rule: RecordGuardRule,
  input: Pick<AuthorizationEvaluationInput, 'record'>
): boolean {
  return input.record !== undefined && RECORD_GUARDS[key].matches(rule, input.record);
}

export function compileRecordGuardSql(
  builder: Knex.QueryBuilder,
  key: RecordGuardKey,
  rule: RecordGuardRule,
  ctx: RelationshipSqlContext
): void {
  RECORD_GUARDS[key].compileSql(builder, rule, ctx);
}
