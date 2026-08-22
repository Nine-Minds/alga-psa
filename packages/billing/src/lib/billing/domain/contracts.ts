/**
 * The contract-billing boundary deliberately contains only resolved facts.  DB
 * rows, scenario records, clocks, and persistence ports belong in adapters.
 */
export type BillingExecutionMode = "simulate" | "live";

export interface ResolvedContractBillingObligation {
  obligationId: string;
  tenantId: string;
  contractLineId?: string;
  chargeFamily: "fixed" | "hourly" | "usage" | "bucket" | "product" | "license" | "other";
  /** Amounts have already been priced by the charge-family implementation. */
  line: Omit<CalculatedBillingLine, "lineKey" | "grossAmount"> & { lineKey?: string };
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
  grossAmount: number;
  currencyCode: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  billingTiming?: "advance" | "arrears";
  explanation?: unknown;
  persistenceRef?: string;
}

export interface ContractBillingCalculationInput {
  schemaVersion: 1;
  execution: { mode: BillingExecutionMode; tenantId: string; calculationId: string; asOf: string };
  document: { clientId: string; currencyCode: string; invoiceWindow: { start: string; endExclusive: string } };
  obligations: ResolvedContractBillingObligation[];
}

export interface ContractBillingCalculationResult {
  schemaVersion: 1;
  calculationId: string;
  mode: BillingExecutionMode;
  currencyCode: string;
  invoiceWindow: { start: string; endExclusive: string };
  lines: CalculatedBillingLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  diagnostics: { code: string; message: string }[];
}

export type LiveContractBillingCalculationResult = ContractBillingCalculationResult & { mode: "live" };
