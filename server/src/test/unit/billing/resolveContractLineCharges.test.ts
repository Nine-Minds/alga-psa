import { describe, expect, it, vi } from "vitest";
import { resolveContractLineCharges } from "@alga-psa/billing/lib/billing/chargeResolution";
import { coveredServiceIds, resolvePoolForService } from "@alga-psa/billing/lib/billing/chargeResolution";
import type {
  ContractChargeSource,
  PoolDefinition,
  PooledTimeExclusion,
  TimingResolution,
} from "@alga-psa/billing/lib/billing/chargeResolution";

const TIMING = {
  servicePeriodStart: "2026-07-01",
  servicePeriodEnd: "2026-08-01",
} as any;

const POOL: PoolDefinition = {
  poolId: "pool-1",
  contractLineId: "cl-1",
  coversAllServices: true,
  memberServiceIds: [],
};

function fakeSource(overrides: Partial<ContractChargeSource> & {
  timing?: TimingResolution;
  pools?: PoolDefinition[];
  periods?: unknown[];
} = {}) {
  const calls: string[] = [];
  const exclusions: Array<PooledTimeExclusion | null> = [];
  const charge = (kind: string) => async () => {
    calls.push(kind);
    return { facts: { kind } as any, taxContext: {} as any };
  };
  const source: ContractChargeSource = {
    line: { clientContractLineId: "ccl-1", tenantId: "t" } as any,
    client: async () => ({ clientId: "c" }),
    resolveTiming: vi.fn(async () => overrides.timing ?? { status: "due", timing: TIMING }),
    taxContext: async () => ({}) as any,
    billingProfile: async () => null,
    pools: async () => overrides.pools ?? [],
    configuredServiceIds: async () => ["svc-a", "svc-b"],
    poolPeriodState: async (pool) => ({
      pool,
      configuration: {} as any,
      periods: (overrides.periods ?? [{}]) as any,
      taxRateIds: [],
    }),
    fixed: charge("fixed") as any,
    hourly: (async (_t: unknown, exclusion: PooledTimeExclusion | null) => {
      exclusions.push(exclusion);
      calls.push("hourly");
      return { facts: { kind: "hourly" } as any, taxContext: {} as any };
    }) as any,
    usage: charge("usage") as any,
    recurringQuantity: (async (kind: string) => {
      calls.push(kind);
      return { facts: { kind } as any, taxContext: {} as any };
    }) as any,
  };
  return { source, calls, exclusions };
}

describe("resolveContractLineCharges", () => {
  it("emits families in registry order", async () => {
    const { source } = fakeSource({ pools: [POOL] });
    const result = await resolveContractLineCharges(source);
    const families = result.map((r) => r.family);
    const order = ["fixed", "hourly", "usage", "bucket", "product", "license"];
    expect(families).toEqual(order.filter((f) => families.includes(f as any)));
    expect(families).toContain("bucket");
  });

  it("asks hourly to leave out pooled services", async () => {
    const { source, exclusions } = fakeSource({ pools: [POOL] });
    await resolveContractLineCharges(source);
    expect(exclusions[0]).toEqual({ serviceIds: ["svc-a", "svc-b"], attributedOnly: true });
  });

  it("pools: ignore skips pool lookups, bucket charge and exclusion", async () => {
    const { source, exclusions } = fakeSource({ pools: [POOL] });
    const poolsSpy = vi.spyOn(source, "pools");
    const result = await resolveContractLineCharges(source, { pools: "ignore" });
    expect(poolsSpy).not.toHaveBeenCalled();
    expect(result.map((r) => r.family)).not.toContain("bucket");
    expect(exclusions[0]).toBeNull();
  });

  it("emits no bucket charge when the line has no pools or the pool has no periods", async () => {
    const none = await resolveContractLineCharges(fakeSource().source);
    expect(none.map((r) => r.family)).not.toContain("bucket");
    const empty = await resolveContractLineCharges(
      fakeSource({ pools: [POOL], periods: [] }).source,
    );
    expect(empty.map((r) => r.family)).not.toContain("bucket");
  });

  it("emits nothing when not due, and only the pool family when untimed", async () => {
    expect(
      await resolveContractLineCharges(
        fakeSource({ timing: { status: "not-due" }, pools: [POOL] }).source,
      ),
    ).toEqual([]);
    const untimed = await resolveContractLineCharges(
      fakeSource({ timing: { status: "untimed" }, pools: [POOL] }).source,
    );
    expect(untimed.map((r) => r.family)).toEqual(["bucket"]);
  });

  it("every family makes a line-position timing demand", async () => {
    const { source } = fakeSource({ pools: [POOL] });
    await resolveContractLineCharges(source);
    const requests = (source.resolveTiming as any).mock.calls.map((c: any[]) => c[0]);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request.duePosition).toBe("line");
  });

  it("assigns stable obligation ids keyed by pool", async () => {
    const { source } = fakeSource({ pools: [POOL] });
    const result = await resolveContractLineCharges(source, {
      families: new Set(["bucket"]),
    });
    expect(result[0].obligation.obligationId).toBe("bucket:ccl-1:pool-1");
    expect(result[0].obligation.taxContextKey).toBe("bucket:ccl-1:pool-1");
  });
});

describe("poolCoverage", () => {
  it("explicit member beats catch-all; catch-all covers configured services only", () => {
    const member: PoolDefinition = { ...POOL, poolId: "m", coversAllServices: false, memberServiceIds: ["svc-x"] };
    const pools = [POOL, member];
    const configured = new Set(["svc-a"]);
    expect(resolvePoolForService(pools, configured, "svc-x")?.poolId).toBe("m");
    expect(resolvePoolForService(pools, configured, "svc-a")?.poolId).toBe("pool-1");
    expect(resolvePoolForService(pools, configured, "svc-other")).toBeNull();
    expect(coveredServiceIds(pools, ["svc-a"])).toEqual(["svc-a", "svc-x"]);
  });
});
