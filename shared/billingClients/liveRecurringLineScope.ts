import type { Knex } from 'knex';

export interface LiveRecurringLineScopeAliases {
  /** Alias of `client_contracts`. */
  cc: string;
  /** Alias of `contracts`. */
  ct: string;
  /** Alias of `contract_lines`. */
  cl: string;
}

export interface LiveRecurringLineScopeOptions {
  /**
   * Materialization and coverage sweeps exclude system-managed default
   * contracts (they carry ad-hoc time only). Engine readers must still see
   * them, so each call site states which behavior it keeps.
   */
  excludeSystemManagedDefault: boolean;
}

/**
 * The single definition of a "live" recurring contract line: the assignment,
 * the contract header and the line itself are all active. The materializer,
 * the materialization guard and the billing engine must agree on this, or a
 * line one of them considers live (and expects periods for) is invisible to
 * another, which blocks every invoice window of the client.
 *
 * Draft state lives on the header (`cc.is_active = false`), not on the lines.
 */
export function scopeToLiveRecurringContractLines<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TQuery extends Knex.QueryBuilder<any, any>,
>(
  query: TQuery,
  aliases: LiveRecurringLineScopeAliases,
  options: LiveRecurringLineScopeOptions,
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
