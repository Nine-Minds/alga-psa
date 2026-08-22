import type { CalculatedBillingLine, ContractBillingCalculationInput, ContractBillingCalculationResult } from "./contracts";

/** Pure canonical assembly for every contract-billing caller. Never add I/O here. */
export function calculateContractBilling(input: ContractBillingCalculationInput): ContractBillingCalculationResult {
  if (!input.execution.tenantId || !input.document.clientId || !input.execution.calculationId) throw new Error("Contract billing requires tenant, client, and calculation identity");
  if (!input.document.invoiceWindow.start || input.document.invoiceWindow.start >= input.document.invoiceWindow.endExclusive) throw new Error("Contract billing invoice window must be half-open and non-empty");
  const lines: CalculatedBillingLine[] = input.obligations.map((obligation, index) => {
    if (obligation.tenantId !== input.execution.tenantId) throw new Error(`Cross-tenant obligation ${obligation.obligationId}`);
    const line = obligation.line;
    if (line.currencyCode !== input.document.currencyCode) throw new Error(`Mixed currency obligation ${obligation.obligationId}`);
    for (const amount of [line.unitRate, line.netAmount, line.taxAmount]) if (!Number.isInteger(amount)) throw new Error(`Contract billing amounts must be integer minor units (${obligation.obligationId})`);
    return { ...line, lineKey: line.lineKey ?? `${obligation.obligationId}:${index}`, obligationId: obligation.obligationId, contractLineId: obligation.contractLineId, chargeFamily: obligation.chargeFamily, grossAmount: line.netAmount + line.taxAmount };
  });
  const subtotal = lines.reduce((total, line) => total + line.netAmount, 0);
  const taxTotal = lines.reduce((total, line) => total + line.taxAmount, 0);
  return { schemaVersion: 1, calculationId: input.execution.calculationId, mode: input.execution.mode, currencyCode: input.document.currencyCode, invoiceWindow: input.document.invoiceWindow, lines, subtotal, taxTotal, total: subtotal + taxTotal, diagnostics: [] };
}
