'use server'

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { listClientBillingProfiles } from '@alga-psa/shared/billingClients/billingProfiles';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assertMspPermission } from '../lib/authHelpers';

/**
 * Which billing profiles a portal user may see (F126, admin side of F123–F127).
 *
 * "No rows" means unrestricted, and that is the default. It is not the same as
 * "no access": a portal user with no rows sees every profile their client has,
 * including profiles created after they were invited. Choosing absence to mean
 * "everything" is what keeps phase-1 behaviour intact without a backfill and
 * stops a newly added profile from silently vanishing from every portal.
 *
 * Selecting every profile explicitly is therefore stored as *no* restriction,
 * so an admin who ticks all the boxes gets the same forward-compatible
 * behaviour as one who ticks none.
 */

export type PortalProfileAccessActionError = ActionMessageError | ActionPermissionError;

const TABLE = 'client_portal_user_billing_profiles';

export interface PortalProfileAccessState {
  /** Every profile the client has, for the picker. */
  profiles: Array<{ billingProfileId: string; name: string; isDefault: boolean }>;
  /** Empty means unrestricted — the user sees all of them. */
  permittedProfileIds: string[];
  isRestricted: boolean;
}

function accessActionErrorFrom(error: unknown): PortalProfileAccessActionError | null {
  if (error instanceof Error && error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  return null;
}

export const getPortalUserBillingProfileAccess = withAuth(async (
  user,
  { tenant },
  input: { portalUserId: string; clientId: string },
): Promise<PortalProfileAccessState | PortalProfileAccessActionError> => {
  try {
    await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read portal access');
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const profiles = await listClientBillingProfiles(trx, tenant, input.clientId);
      const rows = await tenantDb(trx, tenant)
        .table(TABLE)
        .where({ user_id: input.portalUserId })
        .whereIn(
          'billing_profile_id',
          profiles.map((profile) => profile.billing_profile_id),
        )
        .select('billing_profile_id');

      return {
        profiles: profiles.map((profile) => ({
          billingProfileId: profile.billing_profile_id,
          name: profile.name,
          isDefault: profile.is_default,
        })),
        permittedProfileIds: rows.map((row: any) => row.billing_profile_id as string),
        isRestricted: rows.length > 0,
      };
    });
  } catch (error) {
    const expected = accessActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const setPortalUserBillingProfileAccess = withAuth(async (
  user,
  { tenant },
  input: { portalUserId: string; clientId: string; permittedProfileIds: string[] },
): Promise<{ success: true } | PortalProfileAccessActionError> => {
  try {
    await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot manage portal access');
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const profiles = await listClientBillingProfiles(trx, tenant, input.clientId);
      const validIds = new Set(profiles.map((profile) => profile.billing_profile_id));

      const requested = [...new Set(input.permittedProfileIds)].filter((id) => validIds.has(id));
      if (requested.length !== new Set(input.permittedProfileIds).size) {
        return actionError('One of the selected billing profiles does not belong to this client.', 'msp/clients:errors.billingProfile.selectionNotThisClient');
      }

      await db.table(TABLE).where({ user_id: input.portalUserId }).del();

      // Selecting everything is stored as no restriction, so a profile added
      // later stays visible rather than silently dropping out of this user's
      // portal.
      const isRestriction = requested.length > 0 && requested.length < profiles.length;
      if (isRestriction) {
        await db.table(TABLE).insert(
          requested.map((billingProfileId) => ({
            tenant,
            user_id: input.portalUserId,
            billing_profile_id: billingProfileId,
            created_by: user.user_id,
          })),
        );
      }

      return { success: true as const };
    });
  } catch (error) {
    const expected = accessActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
