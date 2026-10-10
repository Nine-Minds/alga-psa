import type { Knex } from 'knex';

/**
 * The one definition of a "live" client-cadence recurring line: an active
 * assignment (`cc`) of an active, non-system-default contract (`ct`) with an
 * enabled, client-cadence-owned line (`cl`) that has billing timing.
 *
 * Callers must have joined `client_contracts as cc`, `contracts as ct` and
 * `contract_lines as cl`. Materialization and materialization-gap detection
 * both use this so a gap is only reported when the materializer can fill it.
 */
export function whereLiveClientCadenceRecurringLine<TQuery extends Knex.QueryBuilder>(
  query: TQuery,
): TQuery {
  return query
    .where('cc.is_active', true)
    .where('ct.is_active', true)
    .where('cl.is_active', true)
    .where((builder) =>
      builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
    )
    .where('cl.cadence_owner', 'client')
    .whereNotNull('cl.billing_timing') as TQuery;
}
