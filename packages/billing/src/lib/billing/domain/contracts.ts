/**
 * The contract-billing boundary deliberately contains only resolved facts.  DB
 * rows, scenario records, clocks, and persistence ports belong in adapters.
 */
export type BillingExecutionMode = "simulate" | "live";

export interface ResolvedContractBillingObligation {
  obligationId: string;
  tenantId: string;
  contractLineId?: string;
  chargeFamily:
    | "fixed"
    | "hourly"
    | "usage"
    | "bucket"
    | "product"
    | "license"
    | "other";
  lineKind?: "charge" | "discount" | "adjustment";
  /** Amounts have already been priced by the charge-family implementation. */
  line: Omit<
    CalculatedBillingLine,
    | "lineKey"
    | "grossAmount"
    | "obligationId"
    | "contractLineId"
    | "chargeFamily"
  > & { lineKey?: string };
}

export interface CalculatedBillingLine {
  lineKey: string;
  obligationId: string;
  contractLineId?: string;
  chargeFamily: ResolvedContractBillingObligation["chargeFamily"];
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
  explanation?: unknown;
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
  obligations: ResolvedContractBillingObligation[];
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
}

export type LiveContractBillingCalculationResult =
  ContractBillingCalculationResult & { mode: "live" };
