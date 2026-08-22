import type {
  ChargeExplanation,
  IAdjustment,
  IBillingCharge,
  IBillingPeriod,
} from "@alga-psa/types";
import type { DiscountComputeCandidate } from "../compute";

/**
 * The contract-billing boundary deliberately contains only resolved facts.  DB
 * rows, scenario records, clocks, and persistence ports belong in adapters.
 */
export type BillingExecutionMode = "simulate" | "live";

export interface ResolvedBillingTiming {
  servicePeriodRecordId?: string | null;
  duePosition: "arrears" | "advance";
  servicePeriodStart: string;
  servicePeriodEnd: string;
  servicePeriodStartExclusive: string;
  servicePeriodEndExclusive: string;
  coverageRatio: number;
}

export interface ResolvedBillingProfileAssignments {
  contractLineBillingProfileId?: string | null;
  contractBillingProfileId?: string | null;
  clientDefaultBillingProfileId: string;
}

/** Pure tax policy snapshot loaded before calculation; no provisioning or I/O. */
export interface ResolvedChargeTaxPolicy {
  getTaxInfoFromService(service: {
    service_id?: string;
    tax_rate_id?: string | null;
  }): { taxRegion: string | null; isTaxable: boolean };
  getLocationTaxRegionCode(
    locationId: string | null | undefined,
  ): string | null;
  getClientDefaultTaxRegionCode(clientId: string): string | null;
  isTaxExemptForProfile(profileId: string | null | undefined): boolean;
  calculateTax(
    clientId: string,
    netAmountInCents: number,
    date: string,
    regionCode: string,
    isTaxable: boolean,
    currencyCode: string,
    billingProfileId?: string | null,
  ): { taxAmount: number; taxRate: number };
}

/**
 * A resolved fact set for one charge family.  Unlike the legacy `line`
 * obligation this deliberately contains no calculated amount: dispatch,
 * proration, tax and rounding are owned by the document calculator.
 */
export interface ResolvedContractLineFacts {
  tenantId: string;
  clientId: string;
  clientContractId?: string | null;
  clientContractLineId: string;
  contractLineId?: string | null;
  contractName?: string | null;
  contractLineName?: string | null;
  contractLineType?: string | null;
  billingTiming?: "advance" | "arrears" | null;
  currencyCode: string;
  locationId?: string | null;
  customRate?: number | string | null;
  endDate?: string | null;
  enableProration?: boolean | null;
  isSystemManagedDefault?: boolean | null;
}

interface ContractChargeFactsBase {
  line: ResolvedContractLineFacts;
  client: { clientId: string; isTaxExempt?: boolean | null };
  timing?: ResolvedBillingTiming;
  billingPeriod?: IBillingPeriod;
  billingProfile?: ResolvedBillingProfileAssignments | null;
}

export type ResolvedContractBillingChargeFacts =
  | (ContractChargeFactsBase & {
      kind: "fixed";
      contractLine: {
        type?: string | null;
        customRate?: number | string | null;
        enableProration?: boolean | null;
      };
      effectiveCustomRate?: number | string | null;
      customRateSource: "pricing_schedule" | "assignment" | null;
      services: Array<{
        serviceId: string;
        serviceName: string;
        defaultRate: number | string | null;
        taxRateId: string | null;
        configurationId: string;
        serviceQuantity?: number | string | null;
        serviceCustomRate?: unknown;
        configurationQuantity?: number | string | null;
        configurationCustomRate?: unknown;
        baseRate: number | string | null;
        enableProration?: boolean | null;
        quantity?: number | string | null;
      }>;
      fallbackService?: {
        serviceId: string;
        serviceName: string | null;
        taxRateId: string | null;
        configurationId: string;
      } | null;
    })
  | (ContractChargeFactsBase & {
      kind: "hourly";
      overtime: {
        enabled?: boolean | null;
        threshold?: number | null;
        rate?: number | null;
      };
      serviceConfigurations: Array<{
        serviceId: string;
        configurationId: string;
        hourlyRate: number;
        minimumBillableTime: number;
        roundUpToNearest: number;
        userTypeRates: Array<{ userType: string; rate: number }>;
      }>;
      activity: Array<{
        sourceId: string;
        userId: string;
        userType?: string | null;
        start: string;
        end: string;
        serviceId: string;
        serviceName?: string | null;
        taxRateId?: string | null;
        customRate?: number | null;
        currencyRate?: number | string | null;
        billableMinutes: number;
        billingProfileId?: string | null;
      }>;
    })
  | (ContractChargeFactsBase & {
      kind: "usage";
      serviceConfigurations: Array<{
        serviceId: string;
        configurationId: string;
        customRate?: number | null;
        minimumUsage?: number | string | null;
        tieredPricing?: boolean | null;
        tiers: Array<{
          minimum: number | string;
          maximum: number | string | null;
          rate: number | string;
        }>;
      }>;
      activity: Array<{
        sourceId: string;
        serviceId: string;
        serviceName?: string | null;
        quantity: number | string;
        taxRateId?: string | null;
        currencyRate?: number | string | null;
      }>;
    })
  | (ContractChargeFactsBase & {
      kind: "bucket";
      configuration: {
        configurationId: string;
        serviceId: string | null;
        serviceName: string;
        taxRateId?: string | null;
        unitOfMeasure?: string | null;
        billingMethod?: string | null;
        includedMinutes?: number | string | null;
        includedHours?: number | string | null;
        overageRate: number | string;
        allowRollover?: boolean | null;
        weighted?: boolean | null;
      };
      periods: Array<{
        start?: string | null;
        end?: string | null;
        minutesUsed?: number | string | null;
        hoursUsed?: number | string | null;
        overageMinutes?: number | string | null;
        overageHours?: number | string | null;
        rolledOverMinutes?: number | string | null;
      }>;
    })
  | (ContractChargeFactsBase & {
      kind: "product" | "license";
      services: Array<{
        serviceId: string;
        serviceName: string;
        defaultRate?: number | string | null;
        taxRateId?: string | null;
        configurationId?: string | null;
        serviceQuantity?: number | string | null;
        serviceCustomRate?: number | string | null;
        configurationQuantity?: number | string | null;
        configurationCustomRate?: number | string | null;
        priceRate?: number | string | null;
      }>;
    });

export interface UnpricedContractBillingObligation {
  obligationId: string;
  tenantId: string;
  contractLineId?: string;
  chargeFamily: ResolvedContractBillingChargeFacts["kind"];
  taxContextKey: string;
  facts: ResolvedContractBillingChargeFacts;
  /** Resolved correlation and display facts; never monetary results. */
  metadata?: {
    serviceId?: string | null;
    description?: string;
    billingProfileId?: string | null;
    recurringServicePeriodId?: string | null;
    sourceId?: string | null;
    persistenceRef?: string;
    quantityLabel?: string;
    lineCycle?: string;
  };
}

export interface CalculatedBillingLine {
  lineKey: string;
  obligationId: string;
  contractLineId?: string;
  chargeFamily:
    | ResolvedContractBillingChargeFacts["kind"]
    | "discount"
    | "adjustment";
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitRate: number;
  netAmount: number;
  taxAmount: number;
  taxRate?: number;
  taxRegion?: string | null;
  grossAmount: number;
  currencyCode: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  billingTiming?: "advance" | "arrears";
  explanation?: ChargeExplanation | null;
  markers?: string[];
  billingProfileId?: string | null;
  recurringServicePeriodId?: string | null;
  sourceId?: string | null;
  persistenceRef?: string;
}

export interface CalculatedDiscount {
  lineKey: string;
  obligationId: string;
  description: string;
  amount: number;
  discountType: "percentage" | "fixed";
  value: number;
  tenant: string;
}

export interface CalculatedAdjustment {
  lineKey: string;
  obligationId: string;
  description: string;
  amount: number;
}

export interface ContractBillingCalculationInput {
  schemaVersion: 1;
  execution: {
    mode: BillingExecutionMode;
    tenantId: string;
    calculationId: string;
    asOf: string;
  };
  document: {
    clientId: string;
    currencyCode: string;
    invoiceWindow: { start: string; endExclusive: string };
  };
  /** Fully resolved facts only. Monetary results are forbidden at this boundary. */
  obligations: UnpricedContractBillingObligation[];
  /** Pure, preloaded tax policies referenced by obligations; loaders own I/O. */
  taxContexts: Record<string, ResolvedChargeTaxPolicy>;
  /** Explicit non-contract carve-out (materials/projects/manual activity). */
  supplementalCharges?: IBillingCharge[];
  discountsAndAdjustments?: {
    billingPeriod: IBillingPeriod;
    discountCandidates: DiscountComputeCandidate[];
    adjustments: IAdjustment[];
  };
}

export interface ContractBillingCalculationResult {
  schemaVersion: 1;
  calculationId: string;
  mode: BillingExecutionMode;
  currencyCode: string;
  invoiceWindow: { start: string; endExclusive: string };
  lines: CalculatedBillingLine[];
  discounts: CalculatedDiscount[];
  adjustments: CalculatedAdjustment[];
  subtotal: number;
  taxTotal: number;
  total: number;
  diagnostics: { code: string; message: string }[];
  /** Rich compute results used only by the guarded production commit adapter. */
  sourceCharges: IBillingCharge[];
}

export type LiveContractBillingCalculationResult =
  ContractBillingCalculationResult & { mode: "live" };
