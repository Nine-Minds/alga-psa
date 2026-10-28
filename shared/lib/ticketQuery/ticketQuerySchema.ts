/**
 * The ticket list's query schema: every path a ticket-list predicate may name, and how each one
 * compiles. The ticket list filter bar, saved views, URLs and the legacy-filter codec all go through
 * this one declaration; there is no other place that decides what "filter by X" means in SQL.
 *
 * ADDING A TICKET-LIST DIMENSION (recipe; mirrored in packages/predicates/README.md)
 *  1. Declare the attribute or relation below. If it is not a plain column, relation or tag set,
 *     add a named computed-attribute resolver in COMPUTED_RESOLVERS and list it in
 *     TICKET_COMPUTED_ATTRIBUTES.
 *  2. If it introduces a new operator, path kind or value type, update
 *     packages/predicates/spec/SEMANTICS.md and add conformance rows first; all backends must pass.
 *  3. Add rows to the table-driven ticket filter matrix
 *     (server/src/test/integration/ticketListFilterMatrix.integration.test.ts) with explicit expected
 *     ids and totals, including the bundled view and a client-portal user.
 *  4. Add an entry to the filter descriptor table for the toolbar and active-filter chip.
 *  5. The new path name is a persisted contract from its first release: stored views and URLs keep
 *     it. Renames go through the alias map in the view migration hook.
 *
 * RAW SQL is allowed in the computed resolvers below and nowhere else in this file. Each resolver is
 * enumerated in TICKET_COMPUTED_ATTRIBUTES, correlates every table it touches on `tenant`, returns a
 * two-valued boolean for the positive form of its operators, and has its own tests
 * (ticketQuerySchema.test.ts).
 *
 * "Self or any child": clauses that cross a relation hop (`client.*`, `contact.*`) or read a set
 * (`tags`) match a bundle master through any of its children when the list is in bundled view. Own
 * columns and computed attributes (board, status, category, assignee, due date, SLA, ...) always
 * describe the row itself.
 */
import { tagSet } from '@alga-psa/predicates/sql';
import type { Attribute, ComputedAttribute, PredicateOperator, QuerySchema, SqlFragment } from '@alga-psa/predicates';
import { ticketSlaBreachedSql } from './ticketSlaSql';

type Resolver = (alias: string, value: unknown, nowIso: string, operator: PredicateOperator) => SqlFragment;

const scalar = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

const COMPUTED_RESOLVERS = (() => {
  // Computed attributes return positive, two-valued predicates; the compiler supplies complements.
  // LEVERAGE: friction computed-scalar-comparisons — computed expressions repeat the compiler's scalar operators; an expression resolver would let the compiler own those comparisons.
  const compare = (expression: SqlFragment, type: 'string' | 'uuid', operator: PredicateOperator, value: unknown): SqlFragment => {
    const repeat = () => [...expression.bindings, ...expression.bindings];
    if (operator === 'is_not_empty') return type === 'string'
      ? { sql: `(${expression.sql}) IS NOT NULL AND (${expression.sql}) <> ''`, bindings: repeat() }
      : { sql: `(${expression.sql}) IS NOT NULL`, bindings: expression.bindings };
    if ((operator === 'equals' || operator === 'not_equals') && value === null) {
      const present = compare(expression, type, 'is_not_empty', undefined);
      return operator === 'equals' ? { sql: `NOT (${present.sql})`, bindings: present.bindings } : present;
    }
    if (operator === 'in') {
      const values = list(value);
      return values.length ? { sql: `COALESCE((${expression.sql}) IN (${values.map(() => '?').join(', ')}), FALSE)`, bindings: [...expression.bindings, ...values] } : { sql: 'FALSE', bindings: [] };
    }
    if (operator === 'equals' || operator === 'not_equals') return {
      sql: `COALESCE((${expression.sql}) ${operator === 'equals' ? '=' : '<>'} ?, FALSE)`, bindings: [...expression.bindings, value],
    };
    if (operator === 'contains' || operator === 'starts_with' || operator === 'ends_with') {
      const escaped = String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
      const pattern = operator === 'contains' ? `%${escaped}%` : operator === 'starts_with' ? `${escaped}%` : `%${escaped}`;
      return { sql: `COALESCE((${expression.sql}) LIKE ? ESCAPE '\\', FALSE)`, bindings: [...expression.bindings, pattern] };
    }
    throw new Error(`Unsupported computed operator ${operator}`);
  };
  return {
  title_folded: (alias, value, _now, operator) => compare({ sql: 'alga_predicate_lower_v1(??)', bindings: [`${alias}.title`] }, 'string', operator, value),
  description_folded: (alias, value, _now, operator) => compare({
    sql: `alga_predicate_lower_v1(alga_checklist_description_v1(??))`,
    bindings: [`${alias}.attributes`],
  }, 'string', operator, value),
  from_service_request: (alias, value) => value === null ? { sql: 'FALSE', bindings: [] } : ({
    sql: `EXISTS (SELECT 1 FROM service_request_submissions AS __sr WHERE __sr.tenant = ?? AND __sr.created_ticket_id = ??) = ?`,
    bindings: [`${alias}.tenant`, `${alias}.ticket_id`, scalar(value)],
  }),
  service_request_definition_id: (alias, value, _now, operator) => compare({
    sql: `(SELECT __sr.definition_id FROM service_request_submissions AS __sr WHERE __sr.tenant = ?? AND __sr.created_ticket_id = ?? LIMIT 1)`,
    bindings: [`${alias}.tenant`, `${alias}.ticket_id`],
  }, 'uuid', operator, value),

  /** `board_inactive equals true|false`: the ticket's board is (not) marked inactive. No board: false. */
  board_inactive: (alias, value) => ({
    sql: `EXISTS (SELECT 1 FROM boards AS __cb WHERE __cb.tenant = ??
      AND __cb.board_id = ?? AND __cb.is_inactive = ?)`,
    bindings: [`${alias}.tenant`, `${alias}.board_id`, scalar(value) === true],
  }),

  /** `status_closed equals true|false`: the ticket's status is (not) a closed status. */
  status_closed: (alias, value) => ({
    sql: `EXISTS (SELECT 1 FROM statuses AS __cs WHERE __cs.tenant = ??
      AND __cs.status_id = ?? AND __cs.is_closed = ?)`,
    bindings: [`${alias}.tenant`, `${alias}.status_id`, scalar(value) === true],
  }),

  /** `status_name equals <name>`: the ticket's status has this exact name (statuses are per board). */
  status_name: (alias, value) => ({
    sql: `EXISTS (SELECT 1 FROM statuses AS __sn WHERE __sn.tenant = ??
      AND __sn.status_id = ?? AND __sn.name = ?)`,
    bindings: [`${alias}.tenant`, `${alias}.status_id`, scalar(value)],
  }),

  /**
   * `category in [ids]`: the ticket's category OR subcategory is one of the ids. Selecting a parent
   * matches its subcategorized tickets; selecting a subcategory matches via subcategory_id.
   * `not_in` is the compiler's negation, so a ticket with neither is kept.
   */
  category: (alias, value) => {
    const ids = list(value);
    if (ids.length === 0) return { sql: 'FALSE', bindings: [] };
    const marks = ids.map(() => '?').join(', ');
    return {
      sql: `COALESCE(?? IN (${marks}) OR ?? IN (${marks}), FALSE)`,
      bindings: [`${alias}.category_id`, ...ids, `${alias}.subcategory_id`, ...ids],
    };
  },

  /**
   * `sla_state equals on_track|breached|paused`. `breached` is the shared definition in
   * ticketSlaSql.ts, the same one the board header's breach count reads.
   */
  sla_state: (alias, value, nowIso) => {
    switch (scalar(value)) {
      case 'breached':
        return {
          sql: `COALESCE(${ticketSlaBreachedSql(alias)}, FALSE)`,
          bindings: [nowIso, nowIso],
        };
      case 'paused':
        return {
          sql: '?? IS NOT NULL AND ?? IS NOT NULL',
          bindings: [`${alias}.sla_policy_id`, `${alias}.sla_paused_at`],
        };
      case 'on_track':
        return {
          sql: `?? IS NOT NULL AND ?? IS NULL
            AND (?? IS NOT NULL OR ?? IS NULL OR ?? >= ?::timestamptz)
            AND (?? IS NOT NULL OR ?? IS NULL OR ?? >= ?::timestamptz)
            AND (?? IS NULL OR ?? = TRUE)
            AND (?? IS NULL OR ?? = TRUE)`,
          bindings: [
            `${alias}.sla_policy_id`,
            `${alias}.sla_paused_at`,
            `${alias}.sla_response_at`,
            `${alias}.sla_response_due_at`,
            `${alias}.sla_response_due_at`,
            nowIso,
            `${alias}.sla_resolution_at`,
            `${alias}.sla_resolution_due_at`,
            `${alias}.sla_resolution_due_at`,
            nowIso,
            `${alias}.sla_response_met`,
            `${alias}.sla_response_met`,
            `${alias}.sla_resolution_met`,
            `${alias}.sla_resolution_met`,
          ],
        };
      default:
        return { sql: 'FALSE', bindings: [] };
    }
  },

  /**
   * `involves_user equals <user id>`: the user is the assignee, an additional agent
   * (ticket_resources), or a member of the assigned team. Backs "assigned to me".
   */
  involves_user: (alias, value) => {
    const userId = scalar(value);
    return {
      sql: `(?? = ?
        OR EXISTS (SELECT 1 FROM ticket_resources AS __tr WHERE __tr.tenant = ??
          AND __tr.ticket_id = ?? AND __tr.additional_user_id = ?)
        OR EXISTS (SELECT 1 FROM team_members AS __tm WHERE __tm.tenant = ??
          AND __tm.team_id = ?? AND __tm.user_id = ?))`,
      bindings: [
        `${alias}.assigned_to`,
        userId,
        `${alias}.tenant`,
        `${alias}.ticket_id`,
        userId,
        `${alias}.tenant`,
        `${alias}.assigned_team_id`,
        userId,
      ],
    };
  },
  } satisfies Record<string, Resolver>;
})();

export type TicketComputedAttributeName = keyof typeof COMPUTED_RESOLVERS;

/** Static facts about each computed attribute; the test asserts this is the complete set. */
const COMPUTED_META: Record<TicketComputedAttributeName, Pick<ComputedAttribute, 'type' | 'operators'>> = {
  title_folded: { type: 'string', operators: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'] },
  description_folded: { type: 'string', operators: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'] },
  from_service_request: { type: 'boolean', operators: ['equals'] },
  service_request_definition_id: { type: 'uuid', operators: ['equals', 'in', 'is_empty', 'is_not_empty'] },
  board_inactive: { type: 'boolean', operators: ['equals'] },
  status_closed: { type: 'boolean', operators: ['equals'] },
  status_name: { type: 'string', operators: ['equals'] },
  category: { type: 'uuid', operators: ['in', 'not_in'] },
  sla_state: { type: 'string', operators: ['equals'] },
  involves_user: { type: 'uuid', operators: ['equals'] },
};

export const TICKET_COMPUTED_ATTRIBUTES = Object.keys(COMPUTED_RESOLVERS) as TicketComputedAttributeName[];

const computed = (name: TicketComputedAttributeName, nowIso: () => string): ComputedAttribute => ({
  kind: 'computed',
  name,
  ...COMPUTED_META[name],
  resolve: ({ alias, value, operator }) => (COMPUTED_RESOLVERS[name] as Resolver)(alias, value, nowIso(), operator),
});

const uuidColumn = (column: string, operators?: ComputedAttribute['operators']): Attribute => ({
  kind: 'column',
  column,
  type: 'uuid',
  ...(operators ? { operators } : {}),
});

/**
 * Builds the ticket query schema. `nowIso` is read when an SLA clause compiles, so tests can pin the
 * clock; the default reads the wall clock.
 */
export function createTicketQuerySchema(nowIso: () => string = () => new Date().toISOString()): QuerySchema {
  return {
    table: 'tickets',
    children: { childColumn: 'master_ticket_id', parentColumn: 'ticket_id' },
    attributes: {
      ticket_origin: { kind: 'column', column: 'ticket_origin', type: 'string', castToText: true, operators: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'] },
      title_folded: computed('title_folded', nowIso),
      description_folded: computed('description_folded', nowIso),
      from_service_request: computed('from_service_request', nowIso),
      service_request_definition_id: computed('service_request_definition_id', nowIso),
      board_id: uuidColumn('board_id'),
      status_id: uuidColumn('status_id'),
      priority_id: uuidColumn('priority_id'),
      category_id: uuidColumn('category_id'),
      subcategory_id: uuidColumn('subcategory_id'),
      assigned_to: uuidColumn('assigned_to'),
      assigned_team_id: uuidColumn('assigned_team_id'),
      master_ticket_id: uuidColumn('master_ticket_id', ['is_empty', 'is_not_empty']),
      sla_policy_id: uuidColumn('sla_policy_id', ['is_empty', 'is_not_empty']),
      due_date: { kind: 'column', column: 'due_date', type: 'timestamp' },
      response_state: { kind: 'column', column: 'response_state', type: 'string', castToText: true, operators: ['equals', 'not_equals', 'in', 'is_empty', 'is_not_empty'] },
      tags: tagSet({ taggedType: 'ticket', local: 'ticket_id' }),
      board_inactive: computed('board_inactive', nowIso),
      status_closed: computed('status_closed', nowIso),
      status_name: computed('status_name', nowIso),
      category: computed('category', nowIso),
      sla_state: computed('sla_state', nowIso),
      involves_user: computed('involves_user', nowIso),
    },
    relations: {
      client: {
        kind: 'one',
        table: 'clients',
        local: 'client_id',
        foreign: 'client_id',
        attributes: {
          id: uuidColumn('client_id', ['equals', 'in']),
          tags: tagSet({ taggedType: 'client', local: 'client_id' }),
        },
      },
      contact: {
        kind: 'one',
        table: 'contacts',
        local: 'contact_name_id',
        foreign: 'contact_name_id',
        attributes: {
          id: uuidColumn('contact_name_id', ['equals', 'in']),
          tags: tagSet({ taggedType: 'contact', local: 'contact_name_id' }),
        },
      },
    },
  };
}

/** Validation-only instance (path and operator checks never read the clock). */
export const ticketQuerySchema: QuerySchema = createTicketQuerySchema();
