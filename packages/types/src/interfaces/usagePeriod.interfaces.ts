import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';

/**
 * A reported whole-period usage count for a Usage service configuration in
 * period-total measurement mode. One logical total per tenant, client, client
 * contract line, service configuration, and canonical service-period boundary.
 *
 * Replacement semantics: writing this period again (edit) replaces the single
 * row — it never appends. `revision` increments on each replacement and is the
 * optimistic-concurrency key. `request_id` makes an identical replay return the
 * original result instead of creating a second consumption event.
 */
export interface IUsagePeriodTotal extends TenantEntity {
  period_total_id: string;
  client_id: string;
  client_contract_line_id: string;
  service_id: string;
  config_id: string;
  /** Canonical service-period boundary, stored as dates (never a generated
   * recurring-period row id) so a regenerated row cannot fork the total. */
  period_start: ISO8601String;
  period_end: ISO8601String;
  quantity: number;
  revision: number;
  request_id?: string | null;
  lifecycle_state: 'recorded' | 'billed';
  invoice_id?: string | null;
  invoice_charge_id?: string | null;
  consumed_at?: ISO8601String | Date | null;
  created_by?: string | null;
  created_at: ISO8601String | Date;
  updated_at: ISO8601String | Date;
}

export interface IUsagePeriodTotalUpsert {
  client_id: string;
  client_contract_line_id: string;
  service_id: string;
  config_id: string;
  period_start: ISO8601String;
  period_end: ISO8601String;
  quantity: number;
  /** Replay key. An identical replay returns the original row; reusing it with
   * different content is rejected. */
  request_id?: string | null;
  /**
   * Expected current revision for an edit. When the stored revision differs the
   * writer is stale and the write is rejected instead of silently overwriting.
   */
  expected_revision?: number | null;
}

/**
 * How a revision resolves its unit rate. `override` stores an explicit rate
 * (zero is a real free-unit price); `catalog` inherits the currency- and
 * period-effective catalog price at billing time and stores no rate.
 */
export type ContractLineUnitPricePolicy = 'override' | 'catalog';

/**
 * Prospective quantity/unit-rate version for a recurring contract item — an
 * explicitly unit-priced Fixed service or a recurring product. Effective at the
 * service-period boundary `effective_period_start`: service periods whose
 * covered start is at/after that date bill the revision values, earlier periods
 * keep the configuration columns and are never rewritten.
 */
export interface IContractLineUnitPricingRevision extends TenantEntity {
  revision_id: string;
  contract_line_id: string;
  service_id: string;
  config_id: string;
  quantity: number;
  /** Null for catalog-policy revisions. */
  unit_rate_cents: number | null;
  price_policy: ContractLineUnitPricePolicy;
  /** Optimistic-concurrency token; increments on each replacement. */
  version: number;
  effective_period_start: ISO8601String;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: ISO8601String | Date;
  updated_at?: ISO8601String | Date | null;
}

export interface IContractLineUnitPricingRevisionInput {
  contract_line_id: string;
  service_id: string;
  config_id: string;
  quantity: number;
  /** Required for `override`; ignored/omitted for `catalog`. */
  unit_rate_cents?: number | null;
  price_policy?: ContractLineUnitPricePolicy;
  /** When supplied, the stored version must match or the write is rejected. */
  expected_version?: number | null;
  effective_period_start: ISO8601String;
  /**
   * Recurring-unit kind. When omitted the server resolves it from the
   * configuration (unit-priced Fixed service vs catalog product).
   */
  kind?: 'service' | 'product';
}

export interface IContractLineUnitPricingRevisionHistoryEntry extends TenantEntity {
  history_id: string;
  revision_id: string;
  contract_line_id: string;
  service_id: string;
  config_id: string;
  quantity: number;
  unit_rate_cents: number | null;
  price_policy: ContractLineUnitPricePolicy;
  effective_period_start: ISO8601String;
  version: number;
  /** Actor who performed the replacement. */
  superseded_by: string;
  recorded_by?: string | null;
  /** Author of the superseded values, when known and different from the replacer. */
  original_created_by?: string | null;
  original_created_at?: ISO8601String | Date | null;
  original_updated_by?: string | null;
  original_updated_at?: ISO8601String | Date | null;
  created_at: ISO8601String | Date;
}
