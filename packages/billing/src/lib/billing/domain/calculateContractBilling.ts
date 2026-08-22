import type { ChargeExplanation, IBillingResult } from "@alga-psa/types";
import {
  calculateContractCharge,
  calculateContractDiscountsAndAdjustments,
} from "./calculateContractCharge";
import type {
  CalculatedBillingLine,
  ContractBillingCalculationInput,
  ContractBillingCalculationResult,
  LiveContractBillingCalculationResult,
} from "./contracts";

/** The single pure financial entry point for contract billing documents. */
export function calculateContractBilling(
  input: ContractBillingCalculationInput,
): ContractBillingCalculationResult {
  if (
    !input.execution.tenantId ||
    !input.document.clientId ||
    !input.execution.calculationId
  ) {
    throw new Error(
      "Contract billing requires tenant, client, and calculation identity",
    );
  }
  if (
    !input.document.invoiceWindow.start ||
    input.document.invoiceWindow.start >=
      input.document.invoiceWindow.endExclusive
  ) {
    throw new Error(
      "Contract billing invoice window must be half-open and non-empty",
    );
  }

  const sourceCharges: ContractBillingCalculationResult["sourceCharges"] = [];
  const lines: CalculatedBillingLine[] = [];
  for (const obligation of input.obligations) {
    if (obligation.tenantId !== input.execution.tenantId)
      throw new Error(`Cross-tenant obligation ${obligation.obligationId}`);
    if (obligation.charge.executionMode !== input.execution.mode)
      throw new Error(
        `Mismatched execution mode for ${obligation.obligationId}`,
      );
    if (obligation.charge.kind !== obligation.chargeFamily)
      throw new Error(
        `Mismatched charge family for ${obligation.obligationId}`,
      );
    const resolvedLine = obligation.charge.inputs.clientContractLine;
    if (resolvedLine.tenant && resolvedLine.tenant !== input.execution.tenantId)
      throw new Error(
        `Cross-tenant contract line for ${obligation.obligationId}`,
      );
    const resolvedCurrency =
      "contractCurrency" in obligation.charge.inputs
        ? obligation.charge.inputs.contractCurrency
        : resolvedLine.currency_code;
    if (resolvedCurrency && resolvedCurrency !== input.document.currencyCode)
      throw new Error(`Mixed currency obligation ${obligation.obligationId}`);
    const calculated = calculateContractCharge(obligation.charge);
    for (const { charge, explanation } of calculated.chargeExplanations) {
      const netAmount = charge.total ?? 0;
      const taxAmount = charge.tax_amount ?? 0;
      if (!Number.isInteger(netAmount) || !Number.isInteger(taxAmount))
        throw new Error(
          `Contract billing amounts must be integer minor units (${obligation.obligationId})`,
        );
      sourceCharges.push(charge);
      lines.push({
        lineKey: explanation.chargeKey,
        obligationId: obligation.obligationId,
        contractLineId:
          obligation.contractLineId ?? charge.client_contract_line_id,
        chargeFamily: obligation.chargeFamily,
        serviceId: charge.serviceId ?? obligation.metadata?.serviceId ?? null,
        description:
          charge.serviceName ??
          obligation.metadata?.description ??
          "Contract charge",
        quantity: charge.quantity ?? charge.duration ?? 1,
        unitRate: charge.rate ?? netAmount,
        netAmount,
        taxAmount,
        taxRate: charge.tax_rate,
        taxRegion: charge.tax_region ?? null,
        grossAmount: netAmount + taxAmount,
        currencyCode: input.document.currencyCode,
        servicePeriodStart: charge.servicePeriodStart,
        servicePeriodEnd: charge.servicePeriodEnd,
        billingTiming: charge.billingTiming,
        explanation,
        markers: explanation.markers,
        billingProfileId:
          obligation.metadata?.billingProfileId ??
          charge.billing_profile_id ??
          null,
        recurringServicePeriodId:
          obligation.metadata?.recurringServicePeriodId ?? null,
        sourceId: obligation.metadata?.sourceId ?? null,
        persistenceRef: obligation.metadata?.persistenceRef,
      });
    }
  }
  for (const [index, charge] of (input.supplementalCharges ?? []).entries()) {
    const netAmount = charge.total ?? 0;
    const taxAmount = charge.tax_amount ?? 0;
    sourceCharges.push(charge);
    lines.push({
      lineKey: `supplemental:${index}`,
      obligationId: `supplemental:${index}`,
      contractLineId: charge.client_contract_line_id,
      chargeFamily:
        charge.type === "time"
          ? "hourly"
          : ((["fixed", "usage", "bucket", "product", "license"].includes(
              charge.type,
            )
              ? charge.type
              : "adjustment") as CalculatedBillingLine["chargeFamily"]),
      serviceId: charge.serviceId ?? null,
      description: charge.serviceName ?? charge.type,
      quantity: charge.quantity ?? charge.duration ?? 1,
      unitRate: charge.rate ?? netAmount,
      netAmount,
      taxAmount,
      taxRate: charge.tax_rate,
      taxRegion: charge.tax_region ?? null,
      grossAmount: netAmount + taxAmount,
      currencyCode: input.document.currencyCode,
      servicePeriodStart: charge.servicePeriodStart,
      servicePeriodEnd: charge.servicePeriodEnd,
      billingTiming: charge.billingTiming,
      explanation: null,
      markers: [],
      billingProfileId: charge.billing_profile_id ?? null,
    });
  }

  const chargeSubtotal = sourceCharges.reduce(
    (sum, charge) => sum + charge.total,
    0,
  );
  const taxTotal = sourceCharges.reduce(
    (sum, charge) => sum + (charge.tax_amount ?? 0),
    0,
  );
  const resolved = input.discountsAndAdjustments
    ? calculateContractDiscountsAndAdjustments(input.execution.mode, {
        billingResult: {
          tenant: input.execution.tenantId,
          charges: sourceCharges,
          totalAmount: chargeSubtotal,
          discounts: [],
          adjustments: [],
          finalAmount: chargeSubtotal,
          currency_code: input.document.currencyCode,
        },
        ...input.discountsAndAdjustments,
      })
    : null;
  const explanationByKey = new Map(
    (resolved?.explanations ?? []).map((explanation) => [
      explanation.chargeKey,
      explanation,
    ]),
  );
  const calculatedDiscounts = (resolved?.billingResult.discounts ?? []).map(
    (discount) => ({
      lineKey: `discount:${discount.discount_id}`,
      obligationId: `discount:${discount.discount_id}`,
      description: discount.discount_name,
      amount: discount.amount ?? 0,
      discountType: discount.discount_type,
      value: discount.value,
      tenant: discount.tenant ?? input.execution.tenantId,
    }),
  );
  const calculatedAdjustments = (resolved?.billingResult.adjustments ?? []).map(
    (adjustment, index) => ({
      lineKey: `adjustment:${index}`,
      obligationId: `adjustment:${index}`,
      description: adjustment.description,
      amount: adjustment.amount,
    }),
  );
  for (const discount of calculatedDiscounts)
    lines.push(
      modifierLine(
        input,
        discount.lineKey,
        discount.description,
        "discount",
        -discount.amount,
        explanationByKey.get(discount.lineKey),
      ),
    );
  for (const adjustment of calculatedAdjustments)
    lines.push(
      modifierLine(
        input,
        adjustment.lineKey,
        adjustment.description,
        "adjustment",
        adjustment.amount,
        explanationByKey.get(adjustment.lineKey),
      ),
    );
  const subtotal = resolved?.billingResult.finalAmount ?? chargeSubtotal;
  return {
    schemaVersion: 1,
    calculationId: input.execution.calculationId,
    mode: input.execution.mode,
    currencyCode: input.document.currencyCode,
    invoiceWindow: input.document.invoiceWindow,
    lines,
    discounts: calculatedDiscounts,
    adjustments: calculatedAdjustments,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    diagnostics: [],
    sourceCharges,
  };
}

function modifierLine(
  input: ContractBillingCalculationInput,
  lineKey: string,
  description: string,
  chargeFamily: "discount" | "adjustment",
  amount: number,
  explanation?: ChargeExplanation,
): CalculatedBillingLine {
  return {
    lineKey,
    obligationId: lineKey,
    chargeFamily,
    description,
    quantity: 1,
    unitRate: amount,
    netAmount: amount,
    taxAmount: 0,
    grossAmount: amount,
    currencyCode: input.document.currencyCode,
    explanation: explanation ?? null,
    markers: explanation?.markers ?? [],
  };
}

export function assertLiveContractBillingResult(
  result: ContractBillingCalculationResult,
): asserts result is LiveContractBillingCalculationResult {
  if (result.mode !== "live")
    throw new Error("Simulation billing results cannot enter live persistence");
}

export function applyCanonicalLiveBillingResult(
  source: IBillingResult,
  result: ContractBillingCalculationResult,
): IBillingResult {
  assertLiveContractBillingResult(result);
  return {
    ...source,
    charges: result.sourceCharges,
    totalAmount: result.sourceCharges.reduce(
      (sum, charge) => sum + charge.total,
      0,
    ),
    discounts: result.discounts.map((discount) => ({
      discount_id: discount.obligationId.replace(/^discount:/, ""),
      discount_name: discount.description,
      discount_type: discount.discountType,
      value: discount.value,
      amount: discount.amount,
      tenant: discount.tenant,
    })),
    adjustments: result.adjustments.map((adjustment) => ({
      description: adjustment.description,
      amount: adjustment.amount,
    })),
    finalAmount: result.subtotal,
  };
}
