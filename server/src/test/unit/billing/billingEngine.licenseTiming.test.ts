import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingEngine } from "@alga-psa/billing/services";
import { TaxService } from "@alga-psa/billing/services/taxService";

vi.mock("@alga-psa/billing/actions/billingAndTax", () => ({
  getNextBillingDate: vi.fn(
    async (_clientId: string, currentEndDate: string) => currentEndDate,
  ),
}));

const buildQuery = (firstResult: any, selectResult: any = []) => {
  const builder: any = {};
  builder.where = vi.fn().mockImplementation((condition: any) => {
    if (typeof condition === "function") {
      condition({
        whereNull: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
      });
    }
    return builder;
  });
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.whereNull = vi.fn().mockImplementation(() => builder);
  builder.whereIn = vi.fn().mockImplementation(() => builder);
  builder.orderBy = vi.fn().mockImplementation(() => builder);
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.leftJoin = vi.fn().mockImplementation(() => builder);
  builder.whereNot = vi.fn().mockImplementation(() => builder);
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockResolvedValue(firstResult);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(selectResult).then(onFulfilled, onRejected),
  );
  return builder;
};

interface LicenseChargeMockOptions {
  licenseRows?: Array<Record<string, any>>;
  taxRegion?: string | undefined;
  isTaxable?: boolean;
}

const installLicenseChargeMocks = (
  engine: BillingEngine,
  options: LicenseChargeMockOptions = {},
) => {
  (engine as any).tenant = "test_tenant";
  vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
    "US-NY",
  );
  vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
    taxRegion: options.taxRegion,
    isTaxable: options.isTaxable ?? false,
  });

  const licenseRows = options.licenseRows ?? [
    {
      service_id: "service-1",
      service_name: "Microsoft 365 Business Premium",
      default_rate: 3100,
      tax_rate_id: "tax-rate-1",
      service_quantity: 1,
      service_line_custom_rate: null,
      configuration_quantity: 1,
      configuration_custom_rate: null,
      price_rate: 3100,
    },
  ];

  (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === "clients") {
      return buildQuery({
        client_id: "client-1",
        tenant: "test_tenant",
        client_name: "Mock Client",
        is_tax_exempt: false,
      });
    }

    if (tableName === "contract_line_services as cls") {
      return buildQuery(null, licenseRows);
    }

    return buildQuery(null);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BillingEngine recurring license timing", () => {
  it("T066: recurring license charges derive timing from canonical service periods under client cadence", async () => {
    const engine = new BillingEngine();
    installLicenseChargeMocks(engine);

    const resolveServicePeriodSpy = vi
      .spyOn(engine as any, "resolveServicePeriod")
      .mockRejectedValue(
        new Error("resolveServicePeriod should not be called for licenses"),
      );

    const charges = await (engine as any).calculateLicenseCharges(
      "client-1",
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
        currency_code: "USD",
        enable_proration: true,
      },
      "monthly",
    );

    expect(resolveServicePeriodSpy).not.toHaveBeenCalled();
    expect(charges).toEqual([
      expect.objectContaining({
        type: "license",
        rate: 2200,
        total: 2200,
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        period_start: "2025-01-10",
        period_end: "2025-01-31",
        billingTiming: "arrears",
        client_contract_id: "assignment-1",
        contract_name: "Acme Corp",
      }),
    ]);
  });

  it("T067: recurring license quantity and price sourcing remain correct after cutover", async () => {
    const engine = new BillingEngine();
    installLicenseChargeMocks(engine, {
      licenseRows: [
        {
          service_id: "service-1",
          service_name: "Microsoft 365 Business Premium",
          default_rate: 2000,
          tax_rate_id: null,
          service_quantity: 7,
          service_line_custom_rate: 4200,
          configuration_quantity: 2,
          configuration_custom_rate: 4500,
          price_rate: 3000,
        },
      ],
    });

    const charges = await (engine as any).calculateLicenseCharges(
      "client-1",
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        billing_timing: "advance",
        start_date: "2025-02-01",
        end_date: null,
        currency_code: "USD",
        enable_proration: false,
      },
      "monthly",
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "license",
        quantity: 2,
        rate: 4500,
        total: 9000,
        servicePeriodStart: "2025-02-01",
        servicePeriodEnd: "2025-02-28",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        billingTiming: "advance",
      }),
    ]);
  });

  it("T068: recurring license tax behavior remains unchanged after moving licenses to canonical service periods", async () => {
    const engine = new BillingEngine();
    installLicenseChargeMocks(engine, {
      taxRegion: "US-NY",
      isTaxable: true,
    });

    const calculateTaxSpy = vi
      .spyOn(TaxService.prototype, "calculateTax")
      .mockResolvedValue({
        taxRate: 0.1,
        taxAmount: 310,
      } as any);

    const charges = await (engine as any).calculateLicenseCharges(
      "client-1",
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
        currency_code: "USD",
        enable_proration: true,
      },
      "monthly",
    );

    expect(calculateTaxSpy).toHaveBeenCalledWith(
      "client-1",
      3100,
      "2025-01-31",
      "US-NY",
      true,
      "USD",
    );
    expect(charges).toEqual([
      expect.objectContaining({
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        period_start: "2025-01-10",
        period_end: "2025-01-31",
        tax_amount: 220,
        tax_rate: 0.1,
      }),
    ]);
  });
});
