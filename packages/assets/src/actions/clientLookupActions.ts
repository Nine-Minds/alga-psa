'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation, IContact } from '@alga-psa/types';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { assertPsaOnlyTenantAccess } from '@shared/services/productAccessGuard';

function tenantScopedTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * clients.client_since is a DATE and the driver builds it at the server's
 * midnight; the client drawer edits it, so hand the calendar date over as
 * 'yyyy-MM-dd' instead of a Date the browser would read a day early.
 */
function withClientSinceDateString<T extends Record<string, any>>(row: T): T {
  const value = row.client_since;
  if (!(value instanceof Date)) return row;
  const pad = (part: number) => String(part).padStart(2, '0');
  return { ...row, client_since: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` };
}

export const getClientByIdForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const result = await tenantScopedTable(trx, tenant, 'clients')
      .select('*')
      .where({ client_id: clientId })
      .first();
    return result ?? null;
  }) as unknown as IClient | null;

  if (!client) {
    return null;
  }

  // Resolve the uploaded logo so the client drawer/detail view shows the real
  // logo (matching the assets table), not just initials.
  const logoUrl = await getClientLogoUrl(clientId, tenant);
  return withClientSinceDateString({ ...client, logoUrl });
});

export const getClientLocationsForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientLocation[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, tenant, 'client_locations')
      .where({
        client_id: clientId,
        is_active: true,
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');
  }) as unknown as IClientLocation[];
});

/**
 * Contacts a device can be assigned to for a client: real people only (shared
 * mailboxes are rejected by the write path) and active ones. The currently
 * assigned contact is kept in the list even if inactive so the picker can
 * still show who the asset belongs to.
 */
export const getClientContactsForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  currentContactId?: string | null
): Promise<IContact[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, tenant, 'contacts')
      .select('contact_name_id', 'tenant', 'client_id', 'full_name', 'email', 'role', 'is_inactive', 'contact_kind')
      .where({ client_id: clientId })
      .whereNot({ contact_kind: 'shared_mailbox' })
      .andWhere(function (this: Knex.QueryBuilder) {
        this.where({ is_inactive: false }).orWhereNull('is_inactive');
        if (currentContactId) {
          this.orWhere({ contact_name_id: currentContactId });
        }
      })
      .orderBy('full_name', 'asc');
  }) as unknown as IContact[];
});

/**
 * Suppliers an asset can be bought from: the tenant's inventory `vendors`.
 * Scoped to the asset surfaces (hence `asset` read, not `vendor` read) so a
 * technician without inventory permissions can still pick a supplier.
 */
export const getVendorOptionsForAssets = withAuth(async (
  user,
  { tenant },
  currentVendorId?: string | null
): Promise<Array<{ vendor_id: string; vendor_name: string }>> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  if (!await hasPermission(user, 'asset', 'read')) return [];
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, tenant, 'vendors')
      .select('vendor_id', 'vendor_name')
      .where(function (this: Knex.QueryBuilder) {
        this.where({ is_active: true });
        // Keep the stored supplier visible even once it is deactivated.
        if (currentVendorId) {
          this.orWhere({ vendor_id: currentVendorId });
        }
      })
      .orderBy('vendor_name', 'asc');
  }) as unknown as Array<{ vendor_id: string; vendor_name: string }>;
});

/**
 * FR-F4: the client's active billing profiles, for the asset form's Billing
 * profile select. The select only appears when there is more than one, so a
 * single-profile client is never asked a question with one answer.
 */
export const getClientBillingProfilesForAssets = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<Array<{ billing_profile_id: string; name: string; is_default: boolean }>> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  if (!await hasPermission(user, 'asset', 'read')) return [];
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, tenant, 'client_billing_profiles')
      .select('billing_profile_id', 'name', 'is_default')
      .where({ client_id: clientId, is_active: true })
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc');
  }) as unknown as Array<{ billing_profile_id: string; name: string; is_default: boolean }>;
});
