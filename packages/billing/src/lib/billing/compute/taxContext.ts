import type { ISO8601String } from "@alga-psa/types";
import type { ChargeComputeTaxContext, ChargeComputeTaxInfo } from "./types";

export interface LoadedChargeTaxRate {
  taxRateId: string;
  regionCode: string | null;
  percentage: number;
  isActive: boolean;
  startDate: ISO8601String;
  endDate: ISO8601String | null;
  currencyCode: string | null;
}

/**
 * Tax identity for one billing profile. Every field is nullable and NULL means
 * "inherit from the client" — the same rule as the columns themselves, which is
 * what makes a profile with nothing filled in behave exactly like the client
 * does today.
 */
export interface LoadedProfileTaxIdentity {
  isTaxExempt: boolean | null;
  reverseCharge: boolean | null;
}

export interface LoadedChargeTaxContext {
  clientId: string;
  clientIsTaxExempt: boolean;
  reverseCharge: boolean;
  clientDefaultRegion: string | null;
  locationRegions: ReadonlyMap<string, string | null>;
  /**
   * Per-profile tax identity (F131). One invoice can legitimately carry both
   * exempt and non-exempt lines — the one-site-many-legal-entities shape is
   * exactly a mix — so exemption is resolved per charge, not once per client.
   * Absent for callers with no profile dimension (the contract simulator),
   * which then get the client-level values, i.e. today's behaviour.
   */
  profileTax?: ReadonlyMap<string, LoadedProfileTaxIdentity>;
  rates: readonly LoadedChargeTaxRate[];
  onMissingRate?: (input: {
    regionCode: string;
    date: ISO8601String;
    currencyCode: string;
  }) => void;
}

const dateOnly = (value: ISO8601String): string => value.slice(0, 10);

/** Build the deterministic tax resolver from tenant-scoped, preloaded rows. */
export function buildChargeComputeTaxContext(
  loaded: LoadedChargeTaxContext,
): ChargeComputeTaxContext {
  const rateById = new Map(loaded.rates.map((rate) => [rate.taxRateId, rate]));

  const identityFor = (billingProfileId: string | null | undefined) => {
    const profile = billingProfileId
      ? loaded.profileTax?.get(billingProfileId)
      : undefined;
    return {
      isTaxExempt: profile?.isTaxExempt ?? loaded.clientIsTaxExempt,
      reverseCharge: profile?.reverseCharge ?? loaded.reverseCharge,
    };
  };

  return {
    getTaxInfoFromService(service): ChargeComputeTaxInfo {
      if (!service.tax_rate_id) return { taxRegion: null, isTaxable: false };
      const rate = rateById.get(service.tax_rate_id);
      return rate?.regionCode
        ? { taxRegion: rate.regionCode, isTaxable: true }
        : { taxRegion: null, isTaxable: false };
    },
    getLocationTaxRegionCode(locationId) {
      return locationId
        ? (loaded.locationRegions.get(locationId) ?? null)
        : null;
    },
    getClientDefaultTaxRegionCode(clientId) {
      return clientId === loaded.clientId ? loaded.clientDefaultRegion : null;
    },
    isTaxExemptForProfile(billingProfileId) {
      return identityFor(billingProfileId).isTaxExempt;
    },
    calculateTax(
      clientId,
      netAmountInCents,
      date,
      regionCode,
      isTaxable,
      currencyCode,
      billingProfileId,
    ) {
      const identity = identityFor(billingProfileId);
      if (
        clientId !== loaded.clientId ||
        identity.isTaxExempt ||
        identity.reverseCharge ||
        !isTaxable ||
        netAmountInCents <= 0
      ) {
        return { taxAmount: 0, taxRate: 0 };
      }

      const onDate = dateOnly(date);
      const applicableRates = loaded.rates.filter(
        (rate) =>
          rate.isActive &&
          rate.regionCode === regionCode &&
          dateOnly(rate.startDate) <= onDate &&
          (rate.endDate == null || dateOnly(rate.endDate) > onDate) &&
          (rate.currencyCode == null || rate.currencyCode === currencyCode),
      );
      const combinedRate = applicableRates.reduce(
        (sum, rate) => sum + rate.percentage,
        0,
      );

      if (applicableRates.length === 0) {
        loaded.onMissingRate?.({ regionCode, date, currencyCode });
      }

      return applicableRates.length > 0
        ? {
            taxAmount: Math.ceil((netAmountInCents * combinedRate) / 100),
            taxRate: combinedRate,
          }
        : { taxAmount: 0, taxRate: 0 };
    },
  };
}
