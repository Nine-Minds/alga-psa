/**
 * The charge family registry: the single ordered list of what a contract line
 * can produce. Order is the order charges are emitted (and merged into the
 * invoice): fixed -> hourly -> usage -> bucket -> product -> license.
 *
 * Adding a family touches four places: one entry here, one `kind` in
 * ResolvedContractBillingChargeFacts, one case in calculateContractChargeImpl,
 * one compute module. Entries only ask the source for data through the port.
 */

import type { ChargeComputeTaxContext } from "../compute";
import type {
  ResolvedBillingTiming,
  ResolvedContractBillingChargeFacts,
  UnpricedContractBillingObligation,
} from "../domain";
import type {
  ChargeFamily,
  ContractChargeSource,
  PoolDefinition,
  PoolPeriodState,
  PooledTimeExclusion,
  TimingRequest,
} from "./types";

export interface PlannedCharge {
  facts: ResolvedContractBillingChargeFacts;
  taxContext: ChargeComputeTaxContext;
  metadata?: UnpricedContractBillingObligation["metadata"];
  /** Discriminator appended to the obligation id when a family emits several. */
  discriminator?: string;
}

export interface FamilyContext {
  source: ContractChargeSource;
  /** Undefined only for the pool family under an `untimed` resolution. */
  timing: ResolvedBillingTiming | undefined;
  /** Pool definitions (empty when pools are ignored). */
  pools: PoolDefinition[];
  /** Services the pools absorb; empty when pools are ignored. */
  pooledServiceIds: string[];
}

export interface FamilyEntry {
  family: ChargeFamily;
  /** The timing demand this family makes of its source. */
  timing: TimingRequest;
  /** True when the family tolerates an `untimed` timing resolution. */
  allowsUntimed?: boolean;
  /** True when the family has nothing to ask the source if the line has no pools. */
  requiresPools?: boolean;
  /**
   * What this family claims. A configured service whose `configuration_type`,
   * or a line whose `contract_line_type`, no entry claims is a configuration
   * the engine cannot price; the resolver reports it in its diagnostics (it
   * never throws, and the line resolves as it always did). Claiming is declaration, not output: a claimed service with no
   * activity this period is fine.
   */
  handles: {
    configurationTypes: readonly string[];
    lineTypes: readonly string[];
    /**
     * Legacy fallback: on a line of one of these types that has no service of
     * this family's `configurationTypes`, the family still prices the line's
     * services whatever their stored configuration_type (the engine's hourly
     * loader falls back to contract_line_services). Those services count as
     * claimed. Optional; most families have none.
     */
    legacyFallbackLineTypes?: readonly string[];
  };
  collect(context: FamilyContext): Promise<PlannedCharge[]>;
}

const LINE_POSITION = "line" as const;

function exclusionFor(context: FamilyContext): PooledTimeExclusion | null {
  return context.pooledServiceIds.length > 0
    ? { serviceIds: context.pooledServiceIds, attributedOnly: true }
    : null;
}

async function poolCharges(context: FamilyContext): Promise<PlannedCharge[]> {
  const { source, timing, pools } = context;
  const states: PoolPeriodState[] = [];
  for (const pool of pools) {
    states.push(await source.poolPeriodState(pool, timing));
  }
  const billingProfile = await source.billingProfile();
  const client = await source.client();
  const planned: PlannedCharge[] = [];
  for (const state of states) {
    // A pool with nothing recorded for the window charges nothing.
    if (state.periods.length === 0) continue;
    planned.push({
      discriminator: state.pool.poolId,
      facts: {
        kind: "bucket",
        line: source.line,
        client,
        timing,
        billingPeriod: source.billingPeriod,
        billingProfile,
        configuration: state.configuration,
        periodContributions: state.periodContributions,
        periods: state.periods,
      },
      taxContext: await source.taxContext({
        taxRateIds: state.taxRateIds,
        billingProfileIds: [
          billingProfile?.contractLineBillingProfileId,
          billingProfile?.contractBillingProfileId,
        ],
        locationId: source.line.locationId,
      }),
      metadata: state.metadata,
    });
  }
  return planned;
}

const single = (
  charge: Pick<PlannedCharge, "facts" | "taxContext" | "metadata"> | null,
): PlannedCharge[] =>
  charge ? [charge] : [];

export const CHARGE_FAMILY_REGISTRY: readonly FamilyEntry[] = [
  {
    family: "fixed",
    handles: { configurationTypes: ["Fixed"], lineTypes: ["Fixed"] },
    timing: { policy: "fixed-recurring", duePosition: LINE_POSITION },
    collect: async ({ source, timing }) => single(await source.fixed(timing!)),
  },
  {
    family: "hourly",
    handles: {
      configurationTypes: ["Hourly"],
      lineTypes: ["Hourly"],
      legacyFallbackLineTypes: ["Hourly"],
    },
    timing: { policy: "service-driven", duePosition: LINE_POSITION },
    collect: async (context) =>
      single(await context.source.hourly(context.timing!, exclusionFor(context))),
  },
  {
    family: "usage",
    handles: { configurationTypes: ["Usage"], lineTypes: ["Usage"] },
    timing: { policy: "service-driven", duePosition: LINE_POSITION },
    collect: async ({ source, timing }) => single(await source.usage(timing!)),
  },
  {
    family: "bucket",
    handles: { configurationTypes: ["Bucket"], lineTypes: ["Bucket"] },
    timing: { policy: "recurring", duePosition: LINE_POSITION },
    allowsUntimed: true,
    requiresPools: true,
    collect: poolCharges,
  },
  {
    family: "product",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: { policy: "recurring", duePosition: LINE_POSITION },
    collect: async ({ source, timing }) =>
      single(await source.recurringQuantity("product", timing!)),
  },
  {
    family: "license",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: { policy: "recurring", duePosition: LINE_POSITION },
    collect: async ({ source, timing }) =>
      single(await source.recurringQuantity("license", timing!)),
  },
];
