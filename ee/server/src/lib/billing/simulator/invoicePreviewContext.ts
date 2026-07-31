import type { Knex } from "knex";
import type {
  ScenarioClientBinding,
  WasmInvoiceViewModel,
} from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";

export interface SimulatorInvoiceParties {
  customer: WasmInvoiceViewModel["customer"];
  tenantClient: WasmInvoiceViewModel["tenantClient"];
}

const formatAddress = (location: Record<string, unknown> | undefined): string =>
  [
    location?.address_line1,
    location?.address_line2,
    location?.city,
    location?.state_province,
    location?.postal_code,
    location?.country_name,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ");

async function loadPreferredLocation(
  db: ReturnType<typeof tenantDb>,
  clientId: string,
): Promise<Record<string, unknown> | undefined> {
  return db
    .table("client_locations")
    .where({ client_id: clientId })
    .orderBy("is_billing_address", "desc")
    .orderBy("is_default", "desc")
    .first(
      "address_line1",
      "address_line2",
      "city",
      "state_province",
      "postal_code",
      "country_name",
    );
}

/** Loads the same party shape consumed by production invoice previews. */
export async function loadSimulatorInvoiceParties(
  knex: Knex,
  tenant: string,
  binding: ScenarioClientBinding,
): Promise<SimulatorInvoiceParties> {
  const db = tenantDb(knex, tenant);

  let customer: WasmInvoiceViewModel["customer"];
  if (binding.kind === "client") {
    const [client, location] = await Promise.all([
      db
        .table("clients")
        .where({ client_id: binding.client_id })
        .first("client_name"),
      loadPreferredLocation(db, binding.client_id),
    ]);
    customer = {
      name: client?.client_name || binding.client_name,
      address: formatAddress(location),
    };
  } else {
    customer = { name: "Hypothetical client", address: "" };
  }

  const tenantCompany = await db
    .table("tenant_companies")
    .where({ is_default: true })
    .whereNull("deleted_at")
    .first("client_id");

  let tenantClient: WasmInvoiceViewModel["tenantClient"] = null;
  if (tenantCompany?.client_id) {
    const [client, location] = await Promise.all([
      db
        .table("clients")
        .where({ client_id: tenantCompany.client_id })
        .first("client_name"),
      loadPreferredLocation(db, tenantCompany.client_id),
    ]);
    const name = client?.client_name?.trim() || null;
    const address = formatAddress(location) || null;
    if (name || address) {
      tenantClient = { name, address, logoUrl: null };
    }
  }

  if (!tenantClient) {
    const tenantRow = await db.table("tenants").first("client_name");
    const name = tenantRow?.client_name?.trim() || null;
    if (name) tenantClient = { name, address: null, logoUrl: null };
  }

  return { customer, tenantClient };
}
