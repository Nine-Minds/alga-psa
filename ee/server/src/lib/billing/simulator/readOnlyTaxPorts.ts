/** Read-only load phase for the simulator's deterministic tax context. */
import type { Knex } from "knex";
import type { SimulationDiagnostic } from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { getClientDefaultTaxRegionCode as getClientDefaultTaxRegionCodeShared } from "@alga-psa/shared/billingClients/clientTax";
import {
  buildChargeComputeTaxContext,
  type ChargeComputeTaxContext,
  type LoadedChargeTaxRate,
} from "@alga-psa/billing/lib/billing/compute";

export interface ReadOnlyTaxPortsOptions {
  clientId: string;
  clientIsTaxExempt: boolean;
  locationIds: string[];
  profileBinding?: { tax_region: string | null; currency_code: string } | null;
  onDiagnostic: (diagnostic: SimulationDiagnostic) => void;
}

export async function createReadOnlyTaxPorts(
  knex: Knex,
  tenant: string,
  options: ReadOnlyTaxPortsOptions,
): Promise<ChargeComputeTaxContext> {
  if (!tenant) {
    throw new Error(
      "Tenant context is required to build simulator tax context",
    );
  }
  const db = tenantDb(knex, tenant);
  const profileBinding = options.profileBinding ?? null;
  const locationIds = Array.from(new Set(options.locationIds.filter(Boolean)));
  const [rateRows, locationRows, settings, clientDefaultRegion] =
    await Promise.all([
      db
        .table("tax_rates")
        .select(
          "tax_rate_id",
          "region_code",
          "tax_percentage",
          "is_active",
          "start_date",
          "end_date",
          "currency_code",
        ),
      locationIds.length > 0
        ? db
            .table("client_locations")
            .whereIn("location_id", locationIds)
            .select("location_id", "region_code")
        : Promise.resolve([]),
      profileBinding
        ? Promise.resolve(null)
        : db
            .table("client_tax_settings")
            .where({ client_id: options.clientId })
            .select("is_reverse_charge_applicable")
            .first(),
      profileBinding
        ? Promise.resolve(profileBinding.tax_region)
        : getClientDefaultTaxRegionCodeShared(knex, tenant, options.clientId),
    ]);

  const rates: LoadedChargeTaxRate[] = rateRows.map((rate) => ({
    taxRateId: rate.tax_rate_id,
    regionCode: rate.region_code ?? null,
    percentage: Number(rate.tax_percentage) || 0,
    isActive: Boolean(rate.is_active),
    startDate: toISODate(toPlainDate(rate.start_date)),
    endDate: rate.end_date ? toISODate(toPlainDate(rate.end_date)) : null,
    currencyCode: rate.currency_code ?? null,
  }));
  const locationRegions = new Map<string, string | null>(
    locationRows.map((row) => [row.location_id, row.region_code ?? null]),
  );
  const emitted = new Set<string>();

  return buildChargeComputeTaxContext({
    clientId: options.clientId,
    clientIsTaxExempt: options.clientIsTaxExempt,
    reverseCharge: Boolean(settings?.is_reverse_charge_applicable),
    clientDefaultRegion,
    locationRegions,
    rates,
    onMissingRate: ({ regionCode, date, currencyCode }) => {
      const key = `${regionCode}:${date}:${currencyCode}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      options.onDiagnostic({
        severity: "warning",
        message: `Tax is shown as 0 because ${regionCode} has no active ${currencyCode || ""} rate on ${date}. Invoice generation would stop on this charge.`,
      });
    },
  });
}
