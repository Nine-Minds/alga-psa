/**
 * Simulation orchestration is deliberately narrow: resolve facts, invoke the
 * shared domain once per document, and map its canonical result for display.
 * It contains no charge-family dispatch, pricing, or production-record shape.
 */
import type { Knex } from "knex";
import type { ContractSimulationResult } from "@alga-psa/types";
import { calculateContractBilling } from "@alga-psa/billing/lib/billing/domain";
import {
  buildSimulatedPeriod,
  loadSimulationCalculationInput,
} from "./loadSimulationCalculationInput";

export async function simulateContractScenario(
  knex: Knex,
  tenant: string,
  scenario: Parameters<typeof loadSimulationCalculationInput>[2],
): Promise<ContractSimulationResult> {
  const input = await loadSimulationCalculationInput(knex, tenant, scenario);
  const periods = input.periods.map((period) => {
    const calculation = calculateContractBilling({
      schemaVersion: 1,
      execution: {
        mode: "simulate",
        tenantId: input.tenant,
        calculationId: `${input.scenario.scenario_id}:${period.window.index}`,
        asOf: `${period.window.startDate}T00:00:00Z`,
      },
      document: {
        clientId:
          input.scenario.client_binding.kind === "client"
            ? input.scenario.client_binding.client_id
            : "simulated-client",
        currencyCode: input.currencyCode,
        invoiceWindow: {
          start: period.window.startDate,
          endExclusive: period.window.endDateExclusive,
        },
      },
      obligations: period.obligations,
      taxContexts: period.taxContexts,
      discountsAndAdjustments: {
        billingPeriod: {
          tenant: input.tenant,
          startDate: period.window.startDate,
          endDate: period.window.endDateExclusive,
        },
        discountCandidates: (input.scenario.discounts ?? []).flatMap(
          (discount) =>
            (discount.contract_line_keys.length
              ? discount.contract_line_keys
              : [null]
            ).map((contractLineId) => ({
              discount_id: discount.discount_id,
              discount_name: discount.discount_name,
              discount_type: discount.discount_type,
              value: discount.value,
              start_date: discount.start_date,
              end_date: discount.end_date,
              contract_line_id: contractLineId,
              tenant: input.tenant,
            })),
        ),
        adjustments: (input.scenario.adjustments ?? []).filter(
          (adjustment) =>
            adjustment.period_index == null ||
            adjustment.period_index === period.window.index,
        ),
      },
    });
    return buildSimulatedPeriod(
      period,
      input.scenario,
      input.contractEndDate,
      input.invoiceParties,
      calculation,
    );
  });
  return {
    scenario_id: input.scenario.scenario_id,
    currency_code: input.currencyCode,
    horizon: input.scenario.horizon,
    periods,
    diagnostics: input.diagnostics,
  };
}
