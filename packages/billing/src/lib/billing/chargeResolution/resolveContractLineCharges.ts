/**
 * The one function that decides which unpriced charges a contract line
 * produces for a service period. The billing engine (database source) and the
 * contract simulator (scenario source) both call it; neither decides charge
 * selection on its own.
 *
 * Rules held here, and nowhere else:
 *  - registry order, and which families are requested;
 *  - the timing demand each family makes of its source (TimingRequest);
 *  - pool coverage: services a pool absorbs are removed from plain hourly
 *    pricing, and a pool with recorded/assumed consumption becomes one bucket
 *    obligation (pool state itself is source-supplied, never computed here);
 *  - obligation identity.
 */

import type { UnpricedContractBillingObligation } from "../domain";
import { coveredServiceIds } from "./poolCoverage";
import { CHARGE_FAMILY_REGISTRY, type FamilyContext } from "./registry";
import type {
  ContractChargeSource,
  ResolutionDiagnostics,
  ResolveContractLineChargesOptions,
  ResolvedContractLineCharges,
  ResolvedLineCharge,
  TimingResolution,
} from "./types";

const NO_DIAGNOSTICS: ResolutionDiagnostics = {
  unhandledLineType: null,
  unhandledServices: [],
};

export function chargeObligationId(
  family: string,
  clientContractLineId: string,
  qualifier: string,
): string {
  return `${family}:${clientContractLineId}:${qualifier}`;
}

/**
 * The order a document lists charges in: every line's timed charges in line
 * order, then the block draws of all lines, then the block issuances (each in
 * the order the sources supplied them). Stable.
 */
// LEVERAGE: friction line-major-emission — the resolver emits line by line, but
// the invoice has always listed block charges after every line's own charges; a
// document-level merge step (not a rank here) would own that order.
const INVOICE_TAIL_RANK: Partial<Record<string, number>> = {
  hourBlockDraw: 1,
  prepaidBlock: 2,
};

export function orderChargesForInvoice<T extends { family: string }>(
  charges: readonly T[],
): T[] {
  const rank = (charge: T) => INVOICE_TAIL_RANK[charge.family] ?? 0;
  return charges
    .map((charge, index) => ({ charge, index }))
    .sort((a, b) => rank(a.charge) - rank(b.charge) || a.index - b.index)
    .map(({ charge }) => charge);
}

export async function resolveContractLineCharges(
  source: ContractChargeSource,
  options: ResolveContractLineChargesOptions = {},
): Promise<ResolvedLineCharge[]> {
  return (await resolveContractLineChargesWithDiagnostics(source, options)).charges;
}

/**
 * As resolveContractLineCharges, plus what the line configures that no family
 * handles. Never throws for that; a source that must fail loudly does so in
 * its optional `reportUnhandled` hook.
 */
export async function resolveContractLineChargesWithDiagnostics(
  source: ContractChargeSource,
  options: ResolveContractLineChargesOptions = {},
): Promise<ResolvedContractLineCharges> {
  const entries = CHARGE_FAMILY_REGISTRY.filter(
    (entry) => !options.families || options.families.has(entry.family),
  );
  if (entries.length === 0) return { charges: [], diagnostics: NO_DIAGNOSTICS };

  const applyPools = (options.pools ?? "apply") === "apply";
  const pools = applyPools ? await source.pools() : [];
  const pooledServiceIds =
    pools.length > 0
      ? coveredServiceIds(pools, await source.configuredServiceIds())
      : [];

  const collected = await Promise.all(
    entries.map(async (entry) => {
      if (entry.requiresPools && pools.length === 0) return [];
      // A window-driven family (timing null) does not ask for a service period.
      const resolution: TimingResolution | null = entry.timing
        ? await source.resolveTiming(entry.timing)
        : null;
      if (resolution?.status === "not-due") return [];
      if (resolution?.status === "untimed" && !entry.allowsUntimed) return [];
      const context: FamilyContext = {
        source,
        timing: resolution?.status === "due" ? resolution.timing : undefined,
        pools: entry.family === "bucket" ? pools : [],
        pooledServiceIds,
      };
      const planned = await entry.collect(context);
      return planned.map((charge): ResolvedLineCharge => {
        const qualifier = charge.discriminator ?? context.timing?.servicePeriodStart ?? "";
        const obligation: UnpricedContractBillingObligation = {
          obligationId: chargeObligationId(
            entry.family,
            source.line.clientContractLineId,
            qualifier,
          ),
          tenantId: source.line.tenantId,
          contractLineId: source.line.clientContractLineId,
          chargeFamily: charge.facts.kind,
          taxContextKey: "",
          facts: charge.facts,
          metadata: charge.metadata,
        };
        obligation.taxContextKey = obligation.obligationId;
        return {
          family: entry.family,
          obligation,
          taxContext: charge.taxContext,
        };
      });
    }),
  );
  // Registry order, regardless of which source query finished first.
  const charges = collected.flat();
  const diagnostics = await diagnose(source, pooledServiceIds);
  if (diagnostics.unhandledLineType || diagnostics.unhandledServices.length > 0) {
    source.reportUnhandled?.(diagnostics);
  }
  return { charges, diagnostics };
}

/**
 * Which configured service kinds and which line type no registry family
 * claims (whether or not a family was requested or produced a charge this
 * period). Driven only by what entries declare in `handles`, so a new family
 * is one registry entry and nothing here. Services a pool absorbed are exempt.
 *
 * Never throws: an unclaimed kind is something the engine's own loaders skip
 * (and an unknown line type was never validated), so the line resolves as it
 * always did and the finding is reported instead.
 */
async function diagnose(
  source: ContractChargeSource,
  pooledServiceIds: readonly string[],
): Promise<ResolutionDiagnostics> {
  const claimedConfigurationTypes = new Set(
    CHARGE_FAMILY_REGISTRY.flatMap((entry) => entry.handles.configurationTypes),
  );
  const claimedLineTypes = new Set(
    CHARGE_FAMILY_REGISTRY.flatMap((entry) => entry.handles.lineTypes),
  );
  const pooled = new Set(pooledServiceIds);
  const lineType = source.line.contractLineType;

  const unhandledLineType =
    lineType && !claimedLineTypes.has(lineType) ? lineType : null;

  // null: the source has not loaded service kinds and will not query for them.
  const services = (await source.configuredServices()) ?? [];
  const hasFallbackFamily =
    lineType != null &&
    CHARGE_FAMILY_REGISTRY.some(
      (entry) =>
        entry.handles.legacyFallbackLineTypes?.includes(lineType) &&
        !services.some((service) =>
          entry.handles.configurationTypes.includes(service.configurationType ?? ""),
        ),
    );
  const unhandledServices = services.filter(
    (service) =>
      !pooled.has(service.serviceId) &&
      !hasFallbackFamily &&
      !claimedConfigurationTypes.has(service.configurationType ?? ""),
  );
  return { unhandledLineType, unhandledServices };
}
