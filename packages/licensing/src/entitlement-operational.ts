import type { Knex } from 'knex';

// Dependency-light on purpose: capability resolvers run in the Temporal worker too.

/**
 * SQL form of `!neverActivated(row)`: the entitlement rows that count as operational authority
 * (admission and participation). A hosted row an unpaid observation created at capacity 0, and that
 * never lapsed, proves no purchase and opens nothing; a pool that was ever active (even one now
 * lapsed or reduced to zero, with history to read) still counts.
 */
// LEVERAGE: pattern never-activated-predicate — `neverActivated(row)` (TS) and this SQL predicate state one rule twice; derive both from one definition if a third form appears.
export function whereEntitlementOperational<T extends Knex.QueryBuilder>(query: T): T {
  return query.where((open) => open
    .whereNot('source', 'hosted')
    .orWhereNotNull('lapse_started_at')
    .orWhereRaw('valid_until > verified_at')) as T;
}
