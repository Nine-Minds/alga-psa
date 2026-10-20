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
  ResolveContractLineChargesOptions,
  ResolvedLineCharge,
  TimingResolution,
} from "./types";

export function chargeObligationId(
  family: string,
  clientContractLineId: string,
  qualifier: string,
): string {
  return `${family}:${clientContractLineId}:${qualifier}`;
}

export async function resolveContractLineCharges(
  source: ContractChargeSource,
  options: ResolveContractLineChargesOptions = {},
): Promise<ResolvedLineCharge[]> {
  const entries = CHARGE_FAMILY_REGISTRY.filter(
    (entry) => !options.families || options.families.has(entry.family),
  );
  if (entries.length === 0) return [];

  const applyPools = (options.pools ?? "apply") === "apply";
  const pools = applyPools ? await source.pools() : [];
  const pooledServiceIds =
    pools.length > 0
      ? coveredServiceIds(pools, await source.configuredServiceIds())
      : [];

  const collected = await Promise.all(
    entries.map(async (entry) => {
      if (entry.requiresPools && pools.length === 0) return [];
      const resolution: TimingResolution = await source.resolveTiming(
        entry.timing,
      );
      if (resolution.status === "not-due") return [];
      if (resolution.status === "untimed" && !entry.allowsUntimed) return [];
      const context: FamilyContext = {
        source,
        timing: resolution.status === "due" ? resolution.timing : undefined,
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
  return collected.flat();
}
