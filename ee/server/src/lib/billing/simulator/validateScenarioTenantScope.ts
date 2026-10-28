import type { Knex } from "knex";
import type { ContractScenario } from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { simulationRefusal } from "./simulationRefusal";

/** Reject identifiers that do not resolve inside the authenticated tenant. */
export async function validateScenarioTenantScope(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
): Promise<void> {
  if (!tenant) throw new Error("Tenant context is required");
  const db = tenantDb(knex, tenant);

  if (scenario.contract_id) {
    // Template scenarios carry the contract_templates.template_id as
    // contract_id (see snapshotContractToScenario), so resolve either source.
    const contract = await db
      .table("contracts")
      .where({ contract_id: scenario.contract_id })
      .first("contract_id");
    const template = contract
      ? undefined
      : await db
          .table("contract_templates")
          .where({ template_id: scenario.contract_id })
          .first("template_id");
    if (!contract && !template) {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_CONTRACT_NOT_FOUND",
        "Scenario contract is not available. It may have been deleted; reload the page.",
      );
    }

    const originIds = Array.from(
      new Set(
        scenario.lines.flatMap((line) =>
          line.origin_contract_line_id ? [line.origin_contract_line_id] : [],
        ),
      ),
    );
    if (originIds.length > 0) {
      const rows = contract
        ? await db
            .table("contract_lines")
            .where({ contract_id: scenario.contract_id })
            .whereIn("contract_line_id", originIds)
            .select("contract_line_id")
        : await db
            .table("contract_template_lines")
            .where({ template_id: scenario.contract_id })
            .whereIn("template_line_id", originIds)
            .select("template_line_id");
      if (rows.length !== originIds.length) {
        throw simulationRefusal(
          "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
          "This scenario refers to a contract line that is no longer available. Reload the page to start from the current contract.",
        );
      }
    }
  }

  const serviceIds = Array.from(
    new Set(
      scenario.lines.flatMap((line) =>
        line.services.map((service) => service.service_id),
      ),
    ),
  );
  if (serviceIds.length > 0) {
    const rows = await db
      .table("service_catalog")
      .whereIn("service_id", serviceIds)
      .select("service_id");
    if (rows.length !== serviceIds.length) {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
        "This scenario refers to a service that is no longer available. Remove the service from the scenario or reload the page.",
      );
    }
  }

  const taxRateIds = Array.from(
    new Set(
      scenario.lines.flatMap((line) =>
        line.services.flatMap((service) =>
          service.tax_rate_id ? [service.tax_rate_id] : [],
        ),
      ),
    ),
  );
  if (taxRateIds.length > 0) {
    const rows = await db
      .table("tax_rates")
      .whereIn("tax_rate_id", taxRateIds)
      .select("tax_rate_id");
    if (rows.length !== taxRateIds.length) {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
        "This scenario refers to a tax rate that is no longer available. Choose another tax rate or reload the page.",
      );
    }
  }

  if (scenario.client_binding.kind === "client") {
    const clientId = scenario.client_binding.client_id;
    const client = await db
      .table("clients")
      .where({ client_id: clientId })
      .first("client_id");
    if (!client) {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
        "Scenario client is not available. It may have been deleted; choose another client.",
      );
    }

    const locationIds = Array.from(
      new Set(
        scenario.lines.flatMap((line) =>
          line.location_id ? [line.location_id] : [],
        ),
      ),
    );
    if (locationIds.length > 0) {
      const rows = await db
        .table("client_locations")
        .where({ client_id: clientId })
        .whereIn("location_id", locationIds)
        .select("location_id");
      if (rows.length !== locationIds.length) {
        throw simulationRefusal(
          "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
          "This scenario refers to a client location that is no longer available. Reload the page to start from the current contract.",
        );
      }
    }
  }
}
