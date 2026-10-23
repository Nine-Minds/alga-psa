import type { Knex } from "knex";
import type { TenantDb } from "@alga-psa/db";

export interface JoinEffectiveServicePriceOptions {
  db: TenantDb;
  /** Query builder that already joins `service_catalog`. */
  query: Knex.QueryBuilder;
  /** Alias of the already-joined `service_catalog`, e.g. `service_catalog as sc`. */
  catalogExpression: string;
  /** Fully-qualified service id column on the catalog join, e.g. `sc.service_id`. */
  catalogServiceColumn: string;
  /** Date (`YYYY-MM-DD`) the price must be effective on or before. */
  asOf: string;
  /** Contract currency; a service price in another currency is not a match. */
  currency: string;
  /** Alias for the joined price row. Defaults to `esp`. */
  alias?: string;
}

function aliasOf(expression: string): string {
  const match = /(?:\s+as\s+|\s+)([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(expression);
  return match ? match[1] : expression.trim();
}

/**
 * Join the effective `service_prices` row for a catalog service in the
 * contract's currency: latest `effective_date <= asOf`.
 *
 * `service_prices` is effective-dated (one row per
 * `(tenant, service, currency, effective_date)`), so a plain equality join would
 * fan a line out across every historical price once a service has more than one.
 * This builds a `DISTINCT ON (tenant, service_id)` lateral of the newest
 * admitted row and left-joins it, exposing `rate` as `<alias>.rate`.
 */
export function joinEffectiveServicePrice(
  options: JoinEffectiveServicePriceOptions,
): Knex.QueryBuilder {
  const alias = options.alias ?? "esp";
  const catalogAlias = aliasOf(options.catalogExpression);
  return options.db.tenantJoinFirstMatching(
    options.query,
    "service_prices",
    alias,
    options.catalogServiceColumn,
    "service_id",
    {
      type: "left",
      rootTenantColumn: `${catalogAlias}.tenant`,
      where: (query, sourceAlias) => {
        query.where(`${sourceAlias}.currency_code`, options.currency);
        query.where(`${sourceAlias}.effective_date`, "<=", options.asOf);
      },
      orderBy: [{ column: "effective_date", order: "desc" }],
    },
  );
}
