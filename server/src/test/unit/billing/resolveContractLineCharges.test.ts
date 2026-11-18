import { describe, expect, it, vi } from "vitest";
import { resolveContractLineCharges, resolveContractLineChargesWithDiagnostics } from "@alga-psa/billing/lib/billing/chargeResolution";
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
  services?: Array<{ serviceId: string; configurationType: string | null }>;
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
    configuredServices: async () =>
      overrides.services ?? [
        { serviceId: "svc-a", configurationType: "Hourly" },
        { serviceId: "svc-b", configurationType: "Hourly" },
      ],
    poolPeriodState: async (pool) => ({
      pool,
      configuration: {} as any,
      periods: (overrides.periods ?? [{}]) as any,
      taxRateIds: [],
    }),
    prepaidBlockIssuances: async () => [],
    hourBlockDraws: async () => null,
    prepaidCoverage: async () => [],
    cadencePrepaidBlock: async () => null,
    fixed: charge("fixed") as any,
    hourly: (async (_t: unknown, exclusion: PooledTimeExclusion | null) => {
      exclusions.push(exclusion);
      calls.push("hourly");
      return { facts: { kind: "hourly", activity: [] } as any, taxContext: {} as any };
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
  const withLine = (source: ContractChargeSource, contractLineType: string) => {
    (source as any).line = { clientContractLineId: "ccl-1", tenantId: "t", contractLineType };
  };

  it("a Hourly line with an unknown-kind service: known services still charge, the unknown one is reported and skipped", async () => {
    const { source, calls } = fakeSource({
      services: [
        { serviceId: "svc-h", configurationType: "Hourly" },
        { serviceId: "svc-x", configurationType: "Mystery" },
      ],
    });
    withLine(source, "Hourly");
    const { charges, diagnostics } = await resolveContractLineChargesWithDiagnostics(source);
    // Same charges as without the unknown service: the resolver never asks a
    // source about individual services, so the unknown one is simply skipped.
    const baseline = fakeSource();
    withLine(baseline.source, "Hourly");
    const expected = await resolveContractLineCharges(baseline.source);
    expect(charges.map((charge) => charge.family)).toEqual(expected.map((charge) => charge.family));
    expect(calls).toEqual(baseline.calls);
    expect(diagnostics).toEqual({
      unhandledLineType: null,
      unhandledServices: [{ serviceId: "svc-x", configurationType: "Mystery" }],
    });
  });

  it("an unknown contract_line_type does not throw and is reported", async () => {
    const { source } = fakeSource();
    withLine(source, "Weird");
    const { charges, diagnostics } = await resolveContractLineChargesWithDiagnostics(source);
    expect(charges.length).toBeGreaterThan(0);
    expect(diagnostics.unhandledLineType).toBe("Weird");
    expect(diagnostics.unhandledServices).toEqual([]);
  });

  it("a source that has not loaded service kinds yields no service diagnostics", async () => {
    const { source } = fakeSource();
    source.configuredServices = async () => null;
    const { diagnostics } = await resolveContractLineChargesWithDiagnostics(source);
    expect(diagnostics.unhandledServices).toEqual([]);
  });

  it("calls the source's reportUnhandled hook only when something is unhandled", async () => {
    const { source } = fakeSource();
    const report = vi.fn();
    source.reportUnhandled = report;
    await resolveContractLineCharges(source);
    expect(report).not.toHaveBeenCalled();
    withLine(source, "Weird");
    await resolveContractLineCharges(source);
    expect(report).toHaveBeenCalledWith({ unhandledLineType: "Weird", unhandledServices: [] });
  });

  it("tolerates unrecognised service kinds on an Hourly line with no Hourly config (legacy fallback)", async () => {
    const { source } = fakeSource({
      services: [{ serviceId: "svc-t", configurationType: "Time" }],
    });
    withLine(source, "Hourly");
    const { diagnostics } = await resolveContractLineChargesWithDiagnostics(source);
    expect(diagnostics.unhandledServices).toEqual([]);
    // ...but not once the line has a real Hourly config alongside it.
    const mixed = fakeSource({
      services: [
        { serviceId: "svc-t", configurationType: "Time" },
        { serviceId: "svc-h", configurationType: "Hourly" },
      ],
    }).source;
    withLine(mixed, "Hourly");
    const result = await resolveContractLineChargesWithDiagnostics(mixed);
    expect(result.diagnostics.unhandledServices.map((service) => service.serviceId)).toEqual(["svc-t"]);
  });

  it("does not flag a service a pool absorbed", async () => {
    const { source } = fakeSource({
      pools: [POOL],
      services: [{ serviceId: "svc-a", configurationType: "Mystery" }],
    });
    const { diagnostics } = await resolveContractLineChargesWithDiagnostics(source);
    expect(diagnostics.unhandledServices).toEqual([]);
  });

  it("a claimed hourly service with no activity resolves to [] without throwing", async () => {
    const { source } = fakeSource();
    source.hourly = async () => null;
    source.fixed = async () => null;
    source.usage = async () => null;
    source.recurringQuantity = async () => null;
    await expect(resolveContractLineCharges(source)).resolves.toEqual([]);
  });

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

  it("every family but the cadence block makes a line-stream timing demand", async () => {
    const { source } = fakeSource({ pools: [POOL] });
    await resolveContractLineCharges(source);
    const requests = (source.resolveTiming as any).mock.calls.map((c: any[]) => c[0]);
    expect(requests.length).toBeGreaterThan(0);
    const streams = new Set(requests.map((request: any) => request.stream));
    expect(streams).toEqual(new Set(["line", "prepaid_block"]));
    expect(
      requests.filter((request: any) => request.stream === "prepaid_block"),
    ).toHaveLength(1);
  });

  describe("cadence prepaid block stream", () => {
    const BLOCK_TIMING = {
      duePosition: "advance",
      servicePeriodStart: "2026-07-01",
      servicePeriodEnd: "2026-07-31",
      coverageRatio: 1,
    } as any;
    const supply = {
      contractLineId: "cl-1",
      blockMinutes: 600,
      blockPrice: 150000,
      rolloverPeriods: 1,
      scopeServiceIds: ["svc-a"],
      soldAsServiceId: "svc-sold",
      serviceName: "Support block",
      soldAsTaxRateId: null,
      cadence: { owner: "contract", billingCycle: "monthly", anchorDate: "2026-07-01" },
    } as any;
    const blockLine = {
      clientContractLineId: "ccl-1",
      contractLineId: "cl-1",
      tenantId: "t",
      contractLineType: "Hourly",
      currencyCode: "EUR",
      enableProration: true,
    } as any;

    // Due on the block stream only: the line (hourly) stream has nothing due.
    const onlyBlockStreamDue = (): TimingResolution | ((r: any) => TimingResolution) =>
      ((request: any) =>
        request.stream === "prepaid_block"
          ? { status: "due", timing: BLOCK_TIMING }
          : { status: "not-due" }) as any;

    it("a line due only on its block stream bills the block and nothing hourly", async () => {
      const { source, calls } = fakeSource();
      source.line = blockLine;
      source.cadencePrepaidBlock = async () => supply;
      (source.resolveTiming as any).mockImplementation(async (request: any) =>
        (onlyBlockStreamDue() as any)(request),
      );
      const result = await resolveContractLineCharges(source);
      expect(result.map((r) => r.family)).toEqual(["cadencePrepaidBlock"]);
      expect(calls).toEqual([]);
      const facts: any = (result[0] as any).facts ?? (result[0] as any).obligation;
      expect(JSON.stringify(facts)).toContain("2026-07-31");
    });

    it("dates the block through the cadence rollover (rollover 1 spans two periods)", async () => {
      const { source } = fakeSource();
      source.line = blockLine;
      source.cadencePrepaidBlock = async () => supply;
      (source.resolveTiming as any).mockImplementation(async (request: any) =>
        (onlyBlockStreamDue() as any)(request),
      );
      const [charge] = await resolveContractLineCharges(source);
      const block = (charge.obligation as any).facts.block;
      expect(block.validFrom).toBe("2026-07-01");
      expect(block.expirationDate).toBe("2026-08-31");
      expect(block.currencyCode).toBe("EUR");
    });

    it("refuses a block with no sold-as service rather than dropping it", async () => {
      const { source } = fakeSource();
      source.line = blockLine;
      source.cadencePrepaidBlock = async () => ({ ...supply, soldAsServiceId: null });
      (source.resolveTiming as any).mockImplementation(async (request: any) =>
        (onlyBlockStreamDue() as any)(request),
      );
      await expect(resolveContractLineCharges(source)).rejects.toThrow(/sold-as service/);
    });

    it("flags hourly overage when the line carries a cadence block", async () => {
      const { source } = fakeSource();
      source.line = blockLine;
      source.cadencePrepaidBlock = async () => supply;
      const result = await resolveContractLineCharges(source, { families: new Set(["hourly"]) });
      expect((result[0].obligation as any).facts.overPrepaidBlock).toBe(true);
    });
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
