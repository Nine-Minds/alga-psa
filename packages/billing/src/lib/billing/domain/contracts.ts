import type {
  ChargeExplanation,
  IAdjustment,
  IBillingCharge,
  IBillingPeriod,
} from "@alga-psa/types";
import type { DiscountComputeCandidate } from "../compute";
import type { ResolvedContractChargeObligation } from "./calculateContractCharge";

/**
 * The contract-billing boundary deliberately contains only resolved facts.  DB
 * rows, scenario records, clocks, and persistence ports belong in adapters.
 */
export type BillingExecutionMode = "simulate" | "live";

/**
 * A resolved fact set for one charge family.  Unlike the legacy `line`
 * obligation this deliberately contains no calculated amount: dispatch,
 * proration, tax and rounding are owned by the document calculator.
 */
export interface UnpricedContractBillingObligation {
  obligationId: string;
  tenantId: string;
  contractLineId?: string;
  chargeFamily: ResolvedContractChargeObligation["kind"];
  charge: ResolvedContractChargeObligation;
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
    | ResolvedContractChargeObligation["kind"]
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
