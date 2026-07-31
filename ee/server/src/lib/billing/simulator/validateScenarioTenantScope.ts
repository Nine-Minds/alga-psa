import type { Knex } from "knex";
import type { ContractScenario } from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";

/** Reject identifiers that do not resolve inside the authenticated tenant. */
export async function validateScenarioTenantScope(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
): Promise<void> {
  if (!tenant) throw new Error("Tenant context is required");
  const db = tenantDb(knex, tenant);

  if (scenario.contract_id) {
    const contract = await db
      .table("contracts")
      .where({ contract_id: scenario.contract_id })
      .first("contract_id");
    if (!contract) throw new Error("Scenario contract is not available");

    const originIds = Array.from(
      new Set(
        scenario.lines.flatMap((line) =>
          line.origin_contract_line_id ? [line.origin_contract_line_id] : [],
        ),
      ),
    );
    if (originIds.length > 0) {
      const rows = await db
        .table("contract_lines")
        .where({ contract_id: scenario.contract_id })
        .whereIn("contract_line_id", originIds)
        .select("contract_line_id");
      if (rows.length !== originIds.length) {
        throw new Error("Scenario contains an invalid contract line reference");
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
      throw new Error("Scenario contains an invalid service reference");
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
      throw new Error("Scenario contains an invalid tax-rate reference");
    }
  }

  if (scenario.client_binding.kind === "client") {
    const clientId = scenario.client_binding.client_id;
    const client = await db
      .table("clients")
      .where({ client_id: clientId })
      .first("client_id");
    if (!client) throw new Error("Scenario client is not available");

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
        throw new Error(
          "Scenario contains an invalid client location reference",
        );
      }
    }
  }
}
