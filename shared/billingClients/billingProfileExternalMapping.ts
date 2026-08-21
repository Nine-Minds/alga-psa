import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { listClientBillingProfiles } from './billingProfiles';

/**
 * Which Alga-side entity an accounting system should see (slice S11,
 * features F116–F121).
 *
 * QuickBooks models "one customer, several billed sub-entities" as a parent
 * customer with sub-customers (`Job: true` plus a `ParentRef`). That maps
 * exactly onto a client with separately-billing profiles, and the mapping table
 * already addresses arbitrary Alga entities by `(alga_entity_type,
 * alga_entity_id)` — so a profile-level mapping needs no schema change at all,
 * only a second entity type alongside `client`.
 *
 * The rule is deliberately narrow. A sub-customer appears **only** for a
 * profile that bills separately on a client that is actually segmented. A
 * client nobody has segmented exports as the plain customer it always has
 * (F119), and a reporting-only segment stays invisible to QuickBooks — it
 * produces no invoice of its own, so a sub-customer for it would be an empty
 * record someone has to reconcile.
 */

export const CLIENT_ENTITY_TYPE = 'client' as const;
export const BILLING_PROFILE_ENTITY_TYPE = 'billing_profile' as const;

export type ExternalMappingEntityType =
  | typeof CLIENT_ENTITY_TYPE
  | typeof BILLING_PROFILE_ENTITY_TYPE;

export interface ExternalMappingTarget {
  /** What the mapping row is keyed on. */
  algaEntityType: ExternalMappingEntityType;
  algaEntityId: string;
  /** Always the client, even for a profile target — a sub-customer needs its parent. */
  clientId: string;
  /** The name the external customer or sub-customer carries. */
  displayName: string;
  /** True when this must be created under the client's parent customer. */
  isSubCustomer: boolean;
}

export interface BillingProfileMappingRow {
  billing_profile_id: string;
  name: string;
  is_default: boolean;
  bills_separately: boolean;
}

/**
 * Profiles of a client that should exist as sub-customers (F118, F120).
 *
 * Empty for an unsegmented client, which is what keeps its accounting export
 * byte-identical to what it produced before this feature existed.
 */
export async function listSubCustomerProfiles(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<BillingProfileMappingRow[]> {
  const profiles = await listClientBillingProfiles(knex, tenant, clientId);
  if (profiles.length <= 1) return [];

  const rows = await tenantDb(knex, tenant)
    .table('client_billing_profiles')
    .where({ client_id: clientId, is_active: true })
    .select('billing_profile_id', 'name', 'is_default', 'bills_separately');

  return (rows as BillingProfileMappingRow[]).filter(
    // The default profile *is* the client for accounting purposes — it bills on
    // the parent customer. Giving it a sub-customer too would split one entity
    // across two QuickBooks records.
    (row) => row.bills_separately && !row.is_default,
  );
}

/**
 * The external entity an invoice should be exported against (F121).
 *
 * Takes the invoice's own profile rather than the client's default, because an
 * invoice raised for a separately-billing site is a demand on that site — an
 * export that lands it on the parent customer puts the balance on the wrong
 * ledger and the wrong statement.
 */
export async function resolveInvoiceExportTarget(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  clientName: string,
  invoiceBillingProfileId: string | null | undefined,
): Promise<ExternalMappingTarget> {
  const clientTarget: ExternalMappingTarget = {
    algaEntityType: CLIENT_ENTITY_TYPE,
    algaEntityId: clientId,
    clientId,
    displayName: clientName,
    isSubCustomer: false,
  };

  // Invoices predating profiles carry none, and export exactly as they used to.
  if (!invoiceBillingProfileId) return clientTarget;

  const subCustomers = await listSubCustomerProfiles(knex, tenant, clientId);
  const profile = subCustomers.find(
    (row) => row.billing_profile_id === invoiceBillingProfileId,
  );
  if (!profile) return clientTarget;

  return {
    algaEntityType: BILLING_PROFILE_ENTITY_TYPE,
    algaEntityId: profile.billing_profile_id,
    clientId,
    displayName: subCustomerDisplayName(clientName, profile.name),
    isSubCustomer: true,
  };
}

/**
 * The name a sub-customer carries in the accounting system.
 *
 * QuickBooks requires `DisplayName` to be unique across every customer in the
 * file, so a bare segment name like "Site B" collides the moment a second
 * client has one. Qualifying it with the parent is both unique and what a
 * bookkeeper scanning the customer list expects to see.
 */
export function subCustomerDisplayName(clientName: string, profileName: string): string {
  return `${clientName}:${profileName}`;
}
