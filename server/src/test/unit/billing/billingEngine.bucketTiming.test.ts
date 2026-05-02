import { describe, expect, it, vi } from "vitest";

import { BillingEngine } from "@alga-psa/billing/services";

const buildQuery = (firstResult: any, selectResult: any = []) => {
  const builder: any = {};
  builder.where = vi.fn().mockImplementation(() => builder);
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.leftJoin = vi.fn().mockImplementation(() => builder);
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockResolvedValue(firstResult);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(selectResult).then(onFulfilled, onRejected),
  );
  return builder;
};

describe("BillingEngine bucket timing", () => {
  it("T056: bucket overage charges map included units to the bucket usage service period instead of the raw invoice window", async () => {
    const engine = new BillingEngine();

    (engine as any).tenant = "test_tenant";
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: "US-NY",
      isTaxable: false,
    });
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );

    const clientsBuilder = buildQuery({
      client_id: "client-1",
      tenant: "test_tenant",
      is_tax_exempt: false,
    });
    const bucketConfigBuilder = buildQuery(null, [
      {
        config_id: "bucket-config-1",
        tenant: "test_tenant",
        service_id: "service-bucket",
        total_minutes: 2400,
        overage_rate: 5000,
        service_name: "Consulting Hours",
        tax_rate_id: "tax-rate-1",
      },
    ]);
    const bucketUsageBuilder = buildQuery(null, [
      {
        tenant: "test_tenant",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-bucket",
        period_start: "2025-01-01",
        period_end: "2025-01-31",
        minutes_used: 45 * 60,
        overage_minutes: 5 * 60,
      },
    ]);

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "clients") {
        return clientsBuilder;
      }
      if (tableName === "contract_line_service_configuration as clsc") {
        return bucketConfigBuilder;
      }
      if (tableName === "bucket_usage") {
        return bucketUsageBuilder;
      }
      return buildQuery(null);
    });

    const charges = await (engine as any).calculateBucketPlanCharges(
      "client-1",
      {
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-02-01T00:00:00Z",
      },
      {
        contract_line_id: "contract-line-1",
        client_contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_name: "Bucket Contract",
        currency_code: "USD",
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "bucket",
        serviceId: "service-bucket",
        config_id: "bucket-config-1",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
        client_contract_id: "assignment-1",
      }),
    ]);
  });

  it("T058: bucket overage charges stay attached to the invoice window that contains their persisted allowance period", async () => {
    const engine = new BillingEngine();

    (engine as any).tenant = "test_tenant";
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: "US-NY",
      isTaxable: false,
    });
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );

    const clientsBuilder = buildQuery({
      client_id: "client-1",
      tenant: "test_tenant",
      is_tax_exempt: false,
    });
    const bucketConfigBuilder = buildQuery(null, [
      {
        config_id: "bucket-config-1",
        tenant: "test_tenant",
        service_id: "service-bucket",
        total_minutes: 2400,
        overage_rate: 5000,
        service_name: "Consulting Hours",
        tax_rate_id: "tax-rate-1",
      },
    ]);
    const bucketUsageBuilder = buildQuery(null, [
      {
        tenant: "test_tenant",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-bucket",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        minutes_used: 46 * 60,
        overage_minutes: 6 * 60,
      },
    ]);

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "clients") {
        return clientsBuilder;
      }
      if (tableName === "contract_line_service_configuration as clsc") {
        return bucketConfigBuilder;
      }
      if (tableName === "bucket_usage") {
        return bucketUsageBuilder;
      }
      return buildQuery(null);
    });

    const charges = await (engine as any).calculateBucketPlanCharges(
      "client-1",
      {
        startDate: "2025-02-01T00:00:00Z",
        endDate: "2025-03-01T00:00:00Z",
      },
      {
        contract_line_id: "contract-line-1",
        client_contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_name: "Bucket Contract",
        currency_code: "USD",
      },
    );

    expect(bucketUsageBuilder.where).toHaveBeenNthCalledWith(
      2,
      "period_start",
      ">=",
      "2025-02-01T00:00:00Z",
    );
    expect(bucketUsageBuilder.where).toHaveBeenNthCalledWith(
      3,
      "period_end",
      "<=",
      "2025-03-01T00:00:00Z",
    );
    expect(charges).toEqual([
      expect.objectContaining({
        type: "bucket",
        serviceId: "service-bucket",
        config_id: "bucket-config-1",
        servicePeriodStart: "2025-02-01",
        servicePeriodEnd: "2025-02-28",
        billingTiming: "arrears",
        client_contract_id: "assignment-1",
      }),
    ]);
  });

  it("T059: usage bucket overages are billed as units rather than divided into hours", async () => {
    const engine = new BillingEngine();

    (engine as any).tenant = "test_tenant";
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: "US-NY",
      isTaxable: false,
    });
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );

    const clientsBuilder = buildQuery({
      client_id: "client-1",
      tenant: "test_tenant",
      is_tax_exempt: false,
    });
    const bucketConfigBuilder = buildQuery(null, [
      {
        config_id: "usage-bucket-config-1",
        tenant: "test_tenant",
        service_id: "service-usage-bucket",
        total_minutes: 1000,
        overage_rate: 20,
        service_name: "Data Transfer",
        tax_rate_id: "tax-rate-1",
        billing_method: "usage",
        unit_of_measure: "GB",
      },
    ]);
    const bucketUsageBuilder = buildQuery(null, [
      {
        tenant: "test_tenant",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-usage-bucket",
        period_start: "2025-02-01",
        period_end: "2025-03-01",
        minutes_used: 1250,
        overage_minutes: 250,
      },
    ]);

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "clients") {
        return clientsBuilder;
      }
      if (tableName === "contract_line_service_configuration as clsc") {
        return bucketConfigBuilder;
      }
      if (tableName === "bucket_usage") {
        return bucketUsageBuilder;
      }
      return buildQuery(null);
    });

    const charges = await (engine as any).calculateBucketPlanCharges(
      "client-1",
      {
        startDate: "2025-02-01T00:00:00Z",
        endDate: "2025-03-01T00:00:00Z",
      },
      {
        contract_line_id: "contract-line-1",
        client_contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_name: "Usage Bucket Contract",
        contract_line_type: "Usage",
        currency_code: "USD",
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "bucket",
        serviceId: "service-usage-bucket",
        config_id: "usage-bucket-config-1",
        isUsageBucket: true,
        unitOfMeasure: "GB",
        unitsUsed: 1250,
        includedUnits: 1000,
        overageUnits: 250,
        quantity: 250,
        rate: 20,
        total: 5000,
      }),
    ]);
  });
});
