import type { Knex } from "knex";
import { tenantDb } from "@alga-psa/db";
import type { BillingProfileSource } from "@alga-psa/types";
import { ensureClientDefaultBillingProfile } from "@alga-psa/shared/billingClients/billingProfiles";
import { resolveChargeProfile } from "./billingProfileResolution";

export { ensureClientDefaultBillingProfile };

/**
 * Database-side lookups for the billing-profile resolution chain, shared by
 * the billing engine, invoice persistence, and the non-recurring charge paths
 * (sales-order invoicing, invoice modification, project schedules).
 *
 * The pure chain lives in `billingProfileResolution.ts`; this module only
 * fetches the assignments it consumes.
 */

/**
 * Step 5 of the chain, and the reason it always terminates.
 *
 * Deliberately a lazy provision rather than a lookup that throws, following the
 * `createDefaultTaxSettings` precedent already in this engine: client rows
 * arrive from many paths — the client actions, the public API, CSV import,
 * onboarding, seeds, test fixtures, direct SQL — and an invariant that only
 * holds when every one of them remembers to cooperate is not an invariant.
 * Client creation provisions eagerly so the profile carries the right name from
 * the start; this is the net under every other path.
 */
export async function getClientDefaultBillingProfileId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<string> {
  return ensureClientDefaultBillingProfile(knex, tenant, clientId);
}

/**
 * Resolve a charge profile for a source record that carries at most an explicit
 * assignment — manual invoice items, sales-order lines, invoice modifications.
 * These have no contract line and no work item, so the chain collapses to
 * "explicit, else client default".
 */
export async function resolveExplicitOrDefaultProfile(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  explicitBillingProfileId?: string | null,
): Promise<{ billingProfileId: string; source: BillingProfileSource }> {
  return resolveChargeProfile({
    explicitBillingProfileId: explicitBillingProfileId ?? null,
    clientDefaultBillingProfileId: await getClientDefaultBillingProfileId(
      knex,
      tenant,
      clientId,
    ),
  });
}

/**
 * Resolve the profile for a charge generated from a contract line outside the
 * recurring engine (project billing schedules, invoice modification). Reads
 * steps 2 and 3 from the line and its contract, then terminates at the client
 * default.
 */
export async function resolveContractLineChargeProfile(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  input: {
    contractLineId?: string | null;
    clientContractId?: string | null;
    workItemBillingProfileId?: string | null;
    explicitBillingProfileId?: string | null;
  },
): Promise<{ billingProfileId: string; source: BillingProfileSource }> {
  const db = tenantDb(knex, tenant);
  const [lineRow, contractRow, clientDefaultBillingProfileId] =
    await Promise.all([
      input.contractLineId
        ? db
            .table("contract_lines")
            .where({ contract_line_id: input.contractLineId })
            .select("billing_profile_id")
            .first()
        : Promise.resolve(undefined),
      input.clientContractId
        ? db
            .table("client_contracts")
            .where({ client_contract_id: input.clientContractId })
            .select("billing_profile_id")
            .first()
        : Promise.resolve(undefined),
      getClientDefaultBillingProfileId(knex, tenant, clientId),
    ]);

  return resolveChargeProfile({
    explicitBillingProfileId: input.explicitBillingProfileId ?? null,
    contractLineBillingProfileId:
      (lineRow?.billing_profile_id as string | null) ?? null,
    contractBillingProfileId:
      (contractRow?.billing_profile_id as string | null) ?? null,
    workItemBillingProfileId: input.workItemBillingProfileId ?? null,
    clientDefaultBillingProfileId,
  });
}

/**
 * The client's profiles, ordered default-first — re-exported from the shared
 * model so the D6 invisibility rule has exactly one implementation.
 */
export {
  listClientBillingProfiles,
  type ClientBillingProfileRow,
} from "@alga-psa/shared/billingClients/billingProfiles";
