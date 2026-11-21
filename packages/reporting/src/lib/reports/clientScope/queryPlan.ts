import { parseTableExpression } from '@alga-psa/db';
import type { QueryDefinition } from '../core/types';
import { classifyTableOwnership } from './ownershipPredicate';
import { clientScopeOk, clientScopeRefused, type ClientScopeResult } from './refusal';

/**
 * Which tables of a report query a client predicate attaches to, or why none can.
 *
 * Walks the primary table and every join, looks each up in the ownership manifest, and returns the
 * "anchors": client-owned tables that are the primary table or inner-joined. Every row such a query returns
 * is a row of each anchor, so a predicate on the anchors restricts the whole result, aggregates included
 * (the predicate runs before the aggregation).
 *
 * Tables that are left-joined only decorate rows an anchor already admitted, so they get no predicate of
 * their own. Tables with no declaration are fine as long as an anchor restricts their rows; they are the
 * reason for refusal only when nothing else can restrict the query.
 *
 * Refused (never run un-narrowed):
 *   - raw SQL: no structure to attach a predicate to;
 *   - a right/full join: it keeps rows from a side no predicate reaches;
 *   - no anchor: nothing client-owned restricts the rows (an undeclared table is named when there is one).
 */

export interface NarrowingAnchor {
  table: string;
  /** How the query names the table (its alias, or the table name). */
  alias: string;
}

export interface QueryNarrowingPlan {
  anchors: NarrowingAnchor[];
}

export function planQueryNarrowing(definition: QueryDefinition): ClientScopeResult<QueryNarrowingPlan> {
  if (definition.table === 'raw_sql') {
    return clientScopeRefused({
      code: 'raw_sql',
      table: 'raw_sql',
      reason: 'it is a raw SQL query, which cannot be limited to a set of clients mechanically',
    });
  }

  const primary = parseTableExpression(definition.table);
  const references: Array<{ table: string; alias: string; anchorCandidate: boolean }> = [
    { table: primary.tableName, alias: primary.rootAlias, anchorCandidate: true },
  ];
  for (const join of definition.joins ?? []) {
    const parsed = parseTableExpression(join.table);
    if (join.type === 'right' || join.type === 'full') {
      return clientScopeRefused({
        code: 'unsupported_join',
        table: parsed.tableName,
        reason: `it uses a ${join.type} join on ${parsed.tableName}, which keeps rows no client limit can reach`,
      });
    }
    references.push({ table: parsed.tableName, alias: parsed.rootAlias, anchorCandidate: join.type === 'inner' });
  }

  const anchors = references
    .filter((ref) => ref.anchorCandidate && classifyTableOwnership(ref.table) === 'owned')
    .map(({ table, alias }) => ({ table, alias }));
  if (anchors.length > 0) return clientScopeOk({ anchors });

  const undeclared = references.find((ref) => classifyTableOwnership(ref.table) === 'undeclared');
  if (undeclared) {
    return clientScopeRefused({
      code: 'undeclared_table',
      table: undeclared.table,
      reason: `${undeclared.table} has no client-ownership declaration, so there is no way to tell which clients its rows belong to`,
    });
  }
  return clientScopeRefused({
    code: 'no_client_anchor',
    table: primary.tableName,
    reason: `none of the tables it reads (${references.map((ref) => ref.table).join(', ')}) belongs to a client, so it cannot be limited to a set of clients`,
  });
}
