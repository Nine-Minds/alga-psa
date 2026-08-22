import type {
  CalculatedBillingLine,
  ContractBillingCalculationInput,
  ContractBillingCalculationResult,
  LiveContractBillingCalculationResult,
} from "./contracts";
import type { IBillingResult } from "@alga-psa/types";

/** Pure canonical assembly for every contract-billing caller. Never add I/O here. */
export function calculateContractBilling(
  input: ContractBillingCalculationInput,
): ContractBillingCalculationResult {
  if (
    !input.execution.tenantId ||
    !input.document.clientId ||
    !input.execution.calculationId
  )
    throw new Error(
      "Contract billing requires tenant, client, and calculation identity",
    );
  if (
    !input.document.invoiceWindow.start ||
    input.document.invoiceWindow.start >=
      input.document.invoiceWindow.endExclusive
  )
    throw new Error(
      "Contract billing invoice window must be half-open and non-empty",
    );
  const lines: CalculatedBillingLine[] = input.obligations.map(
    (obligation, index) => {
      if (obligation.tenantId !== input.execution.tenantId)
        throw new Error(`Cross-tenant obligation ${obligation.obligationId}`);
      const line = obligation.line;
      if (line.currencyCode !== input.document.currencyCode)
        throw new Error(`Mixed currency obligation ${obligation.obligationId}`);
      for (const amount of [line.unitRate, line.netAmount, line.taxAmount])
        if (!Number.isInteger(amount))
          throw new Error(
            `Contract billing amounts must be integer minor units (${obligation.obligationId})`,
          );
      return {
        ...line,
        lineKey: line.lineKey ?? `${obligation.obligationId}:${index}`,
        obligationId: obligation.obligationId,
        contractLineId: obligation.contractLineId,
        chargeFamily: obligation.chargeFamily,
        grossAmount: line.netAmount + line.taxAmount,
      };
    },
  );
  const subtotal = lines.reduce((total, line) => total + line.netAmount, 0);
  const taxTotal = lines.reduce((total, line) => total + line.taxAmount, 0);
  const discounts = input.obligations.flatMap((obligation, index) =>
    obligation.lineKind === "discount"
      ? [
          {
            lineKey: lines[index].lineKey,
            obligationId: obligation.obligationId,
            description: lines[index].description,
            amount: -lines[index].netAmount,
          },
        ]
      : [],
  );
  const adjustments = input.obligations.flatMap((obligation, index) =>
    obligation.lineKind === "adjustment"
      ? [
          {
            lineKey: lines[index].lineKey,
            obligationId: obligation.obligationId,
            description: lines[index].description,
            amount: lines[index].netAmount,
          },
        ]
      : [],
  );
  return {
    schemaVersion: 1,
    calculationId: input.execution.calculationId,
    mode: input.execution.mode,
    currencyCode: input.document.currencyCode,
    invoiceWindow: input.document.invoiceWindow,
    lines,
    discounts,
    adjustments,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    diagnostics: [],
  };
}

/** Persistence adapters must call this guard before accepting a calculation. */
export function assertLiveContractBillingResult(
  result: ContractBillingCalculationResult,
): asserts result is LiveContractBillingCalculationResult {
  if (result.mode !== "live") {
    throw new Error("Simulation billing results cannot enter live persistence");
  }
}

/**
 * Production handoff: persistence keeps its rich source rows, while all
 * document-level monetary totals come from the guarded canonical result.
 */
export function applyCanonicalLiveBillingResult(
  source: IBillingResult,
  result: ContractBillingCalculationResult,
): IBillingResult {
  assertLiveContractBillingResult(result);
  const nonChargeLineKeys = new Set([
    ...result.discounts.map((discount) => discount.lineKey),
    ...result.adjustments.map((adjustment) => adjustment.lineKey),
  ]);
  return {
    ...source,
    totalAmount: result.lines
      .filter((line) => !nonChargeLineKeys.has(line.lineKey))
      .reduce((sum, line) => sum + line.netAmount, 0),
    // Invoice tax is distributed transactionally after details are persisted.
    finalAmount: result.subtotal,
  };
}
