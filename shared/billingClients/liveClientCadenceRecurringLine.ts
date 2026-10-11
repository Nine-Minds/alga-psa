import type { Knex } from 'knex';

export interface LiveRecurringLineAliases {
  /** Alias of `client_contracts`. */
  cc: string;
  /** Alias of `contracts`. */
  ct: string;
  /** Alias of `contract_lines`. */
  cl: string;
}

const DEFAULT_ALIASES: LiveRecurringLineAliases = { cc: 'cc', ct: 'ct', cl: 'cl' };

/**
 * The one definition of a "live" recurring contract line, whatever its cadence
 * owner: the assignment (`cc`), the contract header (`ct`) and the line (`cl`) are
 * all active. Draft state lives on the header/assignment, not on the lines.
 *
 * Materializers, the materialization guard and the billing engine must agree on
 * this, or a line one considers live (and expects periods for) is invisible to
 * another, which blocks every invoice window of the client.
 *
 * `excludeSystemManagedDefault`: materialization and coverage sweeps exclude
 * system-managed default contracts (ad-hoc time only); engine readers and the
 * materialization guard must still see them, so each call site states which it keeps.
 */
export function whereLiveRecurringContractLine<TQuery extends Knex.QueryBuilder>(
  query: TQuery,
  options: { excludeSystemManagedDefault: boolean },
  aliases: LiveRecurringLineAliases = DEFAULT_ALIASES,
): TQuery {
  query
    .where(`${aliases.cc}.is_active`, true)
    .where(`${aliases.ct}.is_active`, true)
    .where(`${aliases.cl}.is_active`, true);

  if (options.excludeSystemManagedDefault) {
    query.where((builder) =>
      builder
        .whereNull(`${aliases.ct}.is_system_managed_default`)
        .orWhere(`${aliases.ct}.is_system_managed_default`, false),
    );
  }

  return query;
}

/**
 * A "live" client-cadence recurring line: a live line (see
 * `whereLiveRecurringContractLine`, system-managed defaults excluded) that is
 * client-cadence-owned and has billing timing.
 *
 * Callers must have joined `client_contracts as cc`, `contracts as ct` and
 * `contract_lines as cl`. Materialization and materialization-gap detection
 * both use this so a gap is only reported when the materializer can fill it.
 */
export function whereLiveClientCadenceRecurringLine<TQuery extends Knex.QueryBuilder>(
  query: TQuery,
): TQuery {
  return whereLiveRecurringContractLine(query, { excludeSystemManagedDefault: true })
    .where('cl.cadence_owner', 'client')
    .whereNotNull('cl.billing_timing') as TQuery;
}
