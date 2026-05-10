import type { EntraSyncUser } from './types';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import {
  OAuthAccountLinkConflictError,
  upsertOAuthAccountLink,
} from '@ee/lib/auth/oauthAccountLinks';

export interface ClientPortalProvisioningContext {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  contactNameId: string;
}

export interface ClientPortalProvisioningConfig {
  provisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
  groupId: string | null;
  membershipMode: 'transitive' | 'direct';
}

export interface ClientPortalProvisioningEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'mode_disabled'
    | 'workflow_managed'
    | 'missing_group'
    | 'missing_identity'
    | 'account_disabled'
    | 'missing_entitlement';
}

export interface ClientPortalProvisioningResult {
  outcome: 'provisioned' | 'skipped_conflict';
  reason?: 'contact_conflict' | 'email_conflict' | 'oauth_link_conflict';
}

export function evaluateClientPortalProvisioningEligibility(
  user: EntraSyncUser,
  config: ClientPortalProvisioningConfig | undefined
): ClientPortalProvisioningEligibility {
  if (!config || config.provisioningMode === 'disabled') {
    return { eligible: false, reason: 'mode_disabled' };
  }
  if (config.provisioningMode === 'workflow_managed') {
    return { eligible: false, reason: 'workflow_managed' };
  }
  if (!config.groupId) {
    return { eligible: false, reason: 'missing_group' };
  }
  if (!user.email && !user.userPrincipalName) {
    return { eligible: false, reason: 'missing_identity' };
  }
  if (!user.accountEnabled) {
    return { eligible: false, reason: 'account_disabled' };
  }
  if (user.clientPortalEntitlement?.isMember !== true) {
    return { eligible: false, reason: 'missing_entitlement' };
  }
  return { eligible: true, reason: 'eligible' };
}

export async function handleEligibleClientPortalProvisioning(
  context: ClientPortalProvisioningContext,
  user: EntraSyncUser
): Promise<ClientPortalProvisioningResult> {
  try {
    const result = await runWithTenant(context.tenantId, async () => {
      const { knex } = await createTenantKnex();
      const normalizedEmail = (user.email || user.userPrincipalName || '').trim().toLowerCase();
      const entraManagedMetadata = {
        managed: true,
        managedTenantId: context.managedTenantId,
        entraTenantId: user.entraTenantId,
        entraObjectId: user.entraObjectId,
        entitlementSource: {
          type: 'group',
          groupId: user.clientPortalEntitlement?.groupId ?? null,
          membershipMode: user.clientPortalEntitlement?.membershipMode ?? null,
        },
        updatedBy: 'entra_sync',
      };

      return knex.transaction(async (trx) => {
        const existingForContact = await trx('users')
          .where({
            tenant: context.tenantId,
            user_type: 'client',
            contact_id: context.contactNameId,
          })
          .select(['user_id', 'email'])
          .orderBy('updated_at', 'desc');
        if (existingForContact.length > 1) {
          return {
            outcome: 'skipped_conflict',
            reason: 'contact_conflict',
          } as ClientPortalProvisioningResult;
        }

        let userId: string | null = existingForContact[0]?.user_id
          ? String(existingForContact[0].user_id)
          : null;

        if (userId) {
          await trx('users')
            .where({
              tenant: context.tenantId,
              user_id: userId,
            })
            .update({
              email: normalizedEmail || trx.raw('email'),
              username: normalizedEmail || trx.raw('username'),
              is_inactive: false,
              client_portal_entra_metadata: entraManagedMetadata,
              updated_at: trx.fn.now(),
            });
        }

        if (!userId) {
          const byEmailRows = normalizedEmail
            ? await trx('users')
                .where({
                  tenant: context.tenantId,
                  user_type: 'client',
                })
                .andWhereRaw('lower(email) = ?', [normalizedEmail])
                .select(['user_id', 'contact_id'])
                .orderBy('updated_at', 'desc')
            : [];

          if (byEmailRows.length > 1) {
            return {
              outcome: 'skipped_conflict',
              reason: 'email_conflict',
            } as ClientPortalProvisioningResult;
          }
          const safeByEmailMatch =
            byEmailRows.length === 1 &&
            (!byEmailRows[0].contact_id || String(byEmailRows[0].contact_id) === context.contactNameId);
          if (byEmailRows.length === 1 && !safeByEmailMatch) {
            return {
              outcome: 'skipped_conflict',
              reason: 'email_conflict',
            } as ClientPortalProvisioningResult;
          }

          if (safeByEmailMatch) {
            userId = String(byEmailRows[0].user_id);
            await trx('users')
              .where({
                tenant: context.tenantId,
                user_id: userId,
              })
              .update({
                contact_id: context.contactNameId,
                username: normalizedEmail || trx.raw('username'),
                email: normalizedEmail || trx.raw('email'),
                is_inactive: false,
                client_portal_entra_metadata: entraManagedMetadata,
                updated_at: trx.fn.now(),
              });
          }
        }

        if (!userId) {
          const inserted = await trx('users')
            .insert({
              tenant: context.tenantId,
              user_id: trx.raw('gen_random_uuid()'),
              username: normalizedEmail,
              email: normalizedEmail,
              first_name: user.givenName?.trim() || user.displayName?.trim() || null,
              last_name: user.surname?.trim() || null,
              user_type: 'client',
              contact_id: context.contactNameId,
              is_inactive: false,
              two_factor_enabled: false,
              is_google_user: false,
              client_portal_entra_metadata: entraManagedMetadata,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            })
            .returning(['user_id']);
          userId = String(inserted[0].user_id);
        }

        const existingMicrosoftLink = await trx('user_auth_accounts')
          .where({
            tenant: context.tenantId,
            provider: 'microsoft',
            provider_account_id: user.entraObjectId,
          })
          .first(['user_id']);
        if (
          existingMicrosoftLink?.user_id &&
          (!userId || String(existingMicrosoftLink.user_id) !== userId)
        ) {
          return {
            outcome: 'skipped_conflict',
            reason: 'oauth_link_conflict',
          } as ClientPortalProvisioningResult;
        }

        await upsertOAuthAccountLink({
          tenant: context.tenantId,
          userId,
          provider: 'microsoft',
          providerAccountId: user.entraObjectId,
          providerEmail: normalizedEmail || null,
          metadata: {
            source: 'entra_sync',
            entraTenantId: user.entraTenantId,
            managedTenantId: context.managedTenantId,
            entitlementGroupId: user.clientPortalEntitlement?.groupId ?? null,
            entitlementMembershipMode: user.clientPortalEntitlement?.membershipMode ?? null,
          },
          lastUsedAt: new Date(),
        });

        return {
          outcome: 'provisioned',
        } as ClientPortalProvisioningResult;
      });
    });
    return result;
  } catch (error) {
    if (error instanceof OAuthAccountLinkConflictError) {
      return {
        outcome: 'skipped_conflict',
        reason: 'oauth_link_conflict',
      };
    }
    throw error;
  }
}
