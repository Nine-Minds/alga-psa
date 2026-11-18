/**
 * The charge family registry: the single ordered list of what a contract line
 * can produce. Order is the order charges are emitted (and merged into the
 * invoice): fixed -> prepaidBlock -> cadencePrepaidBlock -> hourly -> usage ->
 * bucket -> product -> license -> hourBlockDraw. (A document merges lines in the legacy
 * order; see orderChargesForInvoice.)
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
import {
  applyPrepaidCoverage,
  planCadenceBlock,
  selectHourBlockDrawRows,
  selectIssuableBlocks,
} from "./prepaidBlockRules";
import type {
  ChargeFamily,
  ContractChargeSource,
  PoolDefinition,
  PoolPeriodState,
  PooledTimeExclusion,
  SuppliedCharge,
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
  /**
   * The timing demand this family makes of its source. `null` marks a
   * window-driven family: it is not tied to the line being due for a service
   * period, so it runs (and its source answers for its own window) even where
   * every timed family resolves `not-due`.
   */
  timing: TimingRequest | null;
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

const LINE_STREAM = "line" as const;
const PREPAID_BLOCK_STREAM = "prepaid_block" as const;

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

async function prepaidBlockCharges({ source }: FamilyContext): Promise<PlannedCharge[]> {
  const issuable = selectIssuableBlocks(await source.prepaidBlockIssuances());
  if (issuable.length === 0) return [];
  const client = await source.client();
  const taxContext = await source.taxContext({
    taxRateIds: issuable.map((block) => block.issuance.soldAsTaxRateId),
    billingProfileIds: [],
  });
  return issuable.map((block) => ({
    discriminator: block.issuance.issuanceId,
    facts: {
      kind: "prepaidBlock",
      line: source.line,
      client,
      billingPeriod: source.billingPeriod,
      billingProfile: block.billingProfile,
      issuance: block.issuance,
      dueDate: block.dueDate,
    },
    taxContext,
  }));
}

async function cadencePrepaidBlockCharges({
  source,
  timing,
}: FamilyContext): Promise<PlannedCharge[]> {
  const supply = await source.cadencePrepaidBlock();
  if (!supply || !timing) return [];
  const block = planCadenceBlock(supply, source.line, timing);
  const billingProfile = await source.billingProfile();
  return [
    {
      facts: {
        kind: "cadencePrepaidBlock",
        line: source.line,
        client: await source.client(),
        timing,
        billingPeriod: source.billingPeriod,
        billingProfile,
        block,
      },
      taxContext: await source.taxContext({
        taxRateIds: [supply.soldAsTaxRateId],
        billingProfileIds: [
          billingProfile?.contractLineBillingProfileId,
          billingProfile?.contractBillingProfileId,
        ],
        locationId: source.line.locationId,
      }),
    },
  ];
}

/**
 * Removes what the line's prepaid blocks already cover from the hourly
 * activity (see applyPrepaidCoverage). Null when nothing is left to price.
 */
async function withPrepaidCoverage(
  source: ContractChargeSource,
  charge: SuppliedCharge<"hourly">,
): Promise<SuppliedCharge<"hourly"> | null> {
  const activity = charge.facts.activity;
  if (activity.length === 0) return charge;
  const rows = await source.prepaidCoverage(activity.map((entry) => entry.sourceId));
  if (rows.length === 0) return charge;
  const remaining = applyPrepaidCoverage(activity, rows);
  if (remaining.length === 0) return null;
  return { ...charge, facts: { ...charge.facts, activity: remaining } };
}

/**
 * Hourly pricing, flagged when the line carries a cadence Prepaid Block: the
 * time left after the block's coverage is the "over prepaid block" overage,
 * billed at the line's own hourly rate in arrears.
 */
async function hourlyCharges(context: FamilyContext): Promise<PlannedCharge[]> {
  const supplied = await context.source.hourly(context.timing!, exclusionFor(context));
  if (!supplied) return [];
  const charge = await withPrepaidCoverage(context.source, supplied);
  if (!charge) return [];
  const overPrepaidBlock = (await context.source.cadencePrepaidBlock()) !== null;
  return [
    overPrepaidBlock
      ? { ...charge, facts: { ...charge.facts, overPrepaidBlock: true } }
      : charge,
  ];
}

async function hourBlockDrawCharges({ source }: FamilyContext): Promise<PlannedCharge[]> {
  // Prepaid blocks overlay an Hourly line.
  const lineType = source.line.contractLineType;
  if (lineType !== undefined && lineType !== "Hourly") return [];
  const supply = await source.hourBlockDraws();
  if (!supply) return [];
  const allocations = selectHourBlockDrawRows(supply.allocations);
  if (allocations.length === 0) return [];
  return [
    {
      discriminator: supply.period.startDate,
      facts: {
        kind: "hourBlockDraw",
        line: source.line,
        client: await source.client(),
        timing: supply.timing,
        billingPeriod: source.billingPeriod,
        billingProfile: await source.billingProfile(),
        period: supply.period,
        allocations,
      },
      taxContext: await source.taxContext({
        taxRateIds: [],
        billingProfileIds: [],
        locationId: source.line.locationId,
      }),
    },
  ];
}

const single = (
  charge: Pick<PlannedCharge, "facts" | "taxContext" | "metadata"> | null,
): PlannedCharge[] =>
  charge ? [charge] : [];

export const CHARGE_FAMILY_REGISTRY: readonly FamilyEntry[] = [
  {
    family: "fixed",
    handles: { configurationTypes: ["Fixed"], lineTypes: ["Fixed"] },
    timing: { policy: "fixed-recurring", stream: LINE_STREAM },
    collect: async ({ source, timing }) => single(await source.fixed(timing!)),
  },
  {
    family: "prepaidBlock",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: null,
    collect: prepaidBlockCharges,
  },
  {
    family: "cadencePrepaidBlock",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: { policy: "fixed-recurring", stream: PREPAID_BLOCK_STREAM },
    collect: cadencePrepaidBlockCharges,
  },
  {
    family: "hourly",
    handles: {
      configurationTypes: ["Hourly"],
      lineTypes: ["Hourly"],
      legacyFallbackLineTypes: ["Hourly"],
    },
    timing: { policy: "service-driven", stream: LINE_STREAM },
    collect: hourlyCharges,
  },
  {
    family: "usage",
    handles: { configurationTypes: ["Usage"], lineTypes: ["Usage"] },
    timing: { policy: "service-driven", stream: LINE_STREAM },
    collect: async ({ source, timing }) => single(await source.usage(timing!)),
  },
  {
    family: "bucket",
    handles: { configurationTypes: ["Bucket"], lineTypes: ["Bucket"] },
    timing: { policy: "recurring", stream: LINE_STREAM },
    allowsUntimed: true,
    requiresPools: true,
    collect: poolCharges,
  },
  {
    family: "product",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: { policy: "recurring", stream: LINE_STREAM },
    collect: async ({ source, timing }) =>
      single(await source.recurringQuantity("product", timing!)),
  },
  {
    family: "license",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: { policy: "recurring", stream: LINE_STREAM },
    collect: async ({ source, timing }) =>
      single(await source.recurringQuantity("license", timing!)),
  },
  {
    family: "hourBlockDraw",
    handles: { configurationTypes: [], lineTypes: [] },
    timing: null,
    collect: hourBlockDrawCharges,
  },
];

/** Families the source resolves a service-period timing for. */
export const TIMED_CHARGE_FAMILIES: ReadonlySet<ChargeFamily> = new Set(
  CHARGE_FAMILY_REGISTRY.filter((entry) => entry.timing !== null).map(
    (entry) => entry.family,
  ),
);

/** Families whose window the source owns (see FamilyEntry.timing). */
export const WINDOW_DRIVEN_CHARGE_FAMILIES: ReadonlySet<ChargeFamily> = new Set(
  CHARGE_FAMILY_REGISTRY.filter((entry) => entry.timing === null).map(
    (entry) => entry.family,
  ),
);
