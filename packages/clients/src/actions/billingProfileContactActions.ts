'use server'

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assertMspPermission } from '../lib/authHelpers';

/**
 * Which contacts belong to a billing profile, who runs it, and who may see its
 * tickets.
 *
 * A profile already names an invoice recipient through
 * `client_billing_profiles.billing_contact_id`. This is a different question:
 * the people *in* the segment. One of them can be marked its manager, and —
 * separately and explicitly — granted visibility of every ticket attributed to
 * the profile.
 *
 * The two flags stay apart on purpose. Naming someone the manager of a site is
 * an organisational fact; letting them read their colleagues' tickets is a
 * permission. Coupling them would mean an MSP could not record the former
 * without granting the latter.
 */

export type BillingProfileContactActionError = ActionMessageError | ActionPermissionError;

const TABLE = 'billing_profile_contacts';

export interface BillingProfileContact {
  contactNameId: string;
  fullName: string;
  email: string | null;
  isManager: boolean;
  canViewProfileTickets: boolean;
}

export interface BillingProfileContactsState {
  billingProfileId: string;
  clientId: string;
  /** Every contact of the profile's client, so the picker has a candidate list. */
  candidates: Array<{ contactNameId: string; fullName: string; email: string | null }>;
  contacts: BillingProfileContact[];
}

export interface BillingProfileContactInput {
  contactNameId: string;
  isManager?: boolean;
  canViewProfileTickets?: boolean;
}

function profileContactErrorFrom(error: unknown): BillingProfileContactActionError | null {
  if (error instanceof Error && error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  const dbError = error as { code?: string };
  if (dbError?.code === '23505') {
    return actionError(
      'A billing profile can only have one manager.',
      'msp/clients:errors.profileContacts.duplicateManager',
    );
  }
  return null;
}

async function readProfileClientId(
  trx: Knex.Transaction,
  tenant: string,
  billingProfileId: string,
): Promise<string | null> {
  const row = await tenantDb(trx, tenant)
    .table('client_billing_profiles')
    .where({ billing_profile_id: billingProfileId })
    .first('client_id');
  return (row?.client_id as string | undefined) ?? null;
}

export const getBillingProfileContacts = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<BillingProfileContactsState | BillingProfileContactActionError> => {
  try {
    await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read billing profile contacts');
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await readProfileClientId(trx, tenant, input.billingProfileId);
      if (!clientId) {
        return actionError('That billing profile no longer exists.', 'msp/clients:errors.billingProfile.notFound');
      }

      const db = tenantDb(trx, tenant);
      const candidates = await db
        .table('contacts')
        .where({ client_id: clientId })
        .orderBy('full_name', 'asc')
        .select('contact_name_id', 'full_name', 'email');

      const query = db.table(`${TABLE} as bpc`);
      db.tenantJoin(query, 'contacts as c', 'c.contact_name_id', 'bpc.contact_name_id');
      const rows = await query
        .where({ 'bpc.billing_profile_id': input.billingProfileId })
        .orderBy('c.full_name', 'asc')
        .select(
          'bpc.contact_name_id',
          'bpc.is_manager',
          'bpc.can_view_profile_tickets',
          'c.full_name',
          'c.email',
        );

      return {
        billingProfileId: input.billingProfileId,
        clientId,
        candidates: (candidates as any[]).map((row) => ({
          contactNameId: row.contact_name_id,
          fullName: row.full_name ?? '',
          email: row.email ?? null,
        })),
        contacts: (rows as any[]).map((row) => ({
          contactNameId: row.contact_name_id,
          fullName: row.full_name ?? '',
          email: row.email ?? null,
          isManager: Boolean(row.is_manager),
          canViewProfileTickets: Boolean(row.can_view_profile_tickets),
        })),
      };
    });
  } catch (error) {
    const expected = profileContactErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Replaces the profile's contact list wholesale, which is how the editor sends
 * it: removing a row is a real operation, and a partial update could not
 * express it.
 */
export const setBillingProfileContacts = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string; contacts: BillingProfileContactInput[] },
): Promise<{ success: true } | BillingProfileContactActionError> => {
  try {
    await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot manage billing profile contacts');
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await readProfileClientId(trx, tenant, input.billingProfileId);
      if (!clientId) {
        return actionError('That billing profile no longer exists.', 'msp/clients:errors.billingProfile.notFound');
      }

      const db = tenantDb(trx, tenant);
      const requested = [...new Map(input.contacts.map((entry) => [entry.contactNameId, entry])).values()];

      if (requested.length > 0) {
        // A contact from another client would be a cross-client grant, which is
        // a data-access defect rather than a UI slip.
        const owned = await db
          .table('contacts')
          .where({ client_id: clientId })
          .whereIn('contact_name_id', requested.map((entry) => entry.contactNameId))
          .select('contact_name_id');
        if (owned.length !== requested.length) {
          return actionError(
            'One of the selected contacts does not belong to this billing profile\'s client.',
            'msp/clients:errors.profileContacts.notThisClient',
          );
        }
      }

      const managers = requested.filter((entry) => entry.isManager);
      if (managers.length > 1) {
        return actionError(
          'A billing profile can only have one manager.',
          'msp/clients:errors.profileContacts.duplicateManager',
        );
      }

      await db.table(TABLE).where({ billing_profile_id: input.billingProfileId }).del();
      if (requested.length > 0) {
        await db.table(TABLE).insert(requested.map((entry) => ({
          tenant,
          billing_profile_id: input.billingProfileId,
          contact_name_id: entry.contactNameId,
          is_manager: Boolean(entry.isManager),
          can_view_profile_tickets: Boolean(entry.canViewProfileTickets),
          created_by: user.user_id,
        })));
      }

      return { success: true as const };
    });
  } catch (error) {
    const expected = profileContactErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Every billing profile a contact belongs to, for the read-only display on the
 * contact record. Scoped to the contact's own client so a stale association
 * left behind by a merge cannot surface another client's profile.
 */
export const getContactBillingProfiles = withAuth(async (
  user,
  { tenant },
  input: { contactNameId: string },
): Promise<
  | Array<{ billingProfileId: string; name: string; isManager: boolean; canViewProfileTickets: boolean }>
  | BillingProfileContactActionError
> => {
  try {
    await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read billing profile contacts');
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const contact = await db
        .table('contacts')
        .where({ contact_name_id: input.contactNameId })
        .first('client_id');
      if (!contact?.client_id) return [];

      const query = db.table(`${TABLE} as bpc`);
      db.tenantJoin(query, 'client_billing_profiles as p', 'p.billing_profile_id', 'bpc.billing_profile_id');
      const rows = await query
        .where({ 'bpc.contact_name_id': input.contactNameId, 'p.client_id': contact.client_id })
        .orderBy('p.name', 'asc')
        .select('bpc.billing_profile_id', 'bpc.is_manager', 'bpc.can_view_profile_tickets', 'p.name');

      return (rows as any[]).map((row) => ({
        billingProfileId: row.billing_profile_id,
        name: row.name,
        isManager: Boolean(row.is_manager),
        canViewProfileTickets: Boolean(row.can_view_profile_tickets),
      }));
    });
  } catch (error) {
    const expected = profileContactErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
