import type { EntraSyncUser } from './types';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@alga-psa/core/encryption';
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
  defaultRoleName?: string;
}

export interface ClientPortalProvisioningConfig {
  provisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
  groupId: string | null;
  membershipMode: 'transitive';
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
  reason?: 'contact_conflict' | 'email_conflict' | 'oauth_link_conflict' | 'role_conflict';
}

export interface ClientPortalLifecycleResult {
  outcome: 'none' | 'deactivated' | 'reactivated';
  reason?: 'missing_entitlement' | 'account_disabled';
}

type EntraMetadata = {
  managed?: boolean;
  lifecycle?: {
    state?: string;
    owner?: string;
    reason?: string;
    updatedAt?: string;
  };
  [key: string]: unknown;
};

function parseEntraMetadata(value: unknown): EntraMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as EntraMetadata;
}

function shouldReactivateUser(isInactive: boolean, metadataRaw: unknown): boolean {
  if (!isInactive) {
    return false;
  }
  const metadata = parseEntraMetadata(metadataRaw);
  return metadata.lifecycle?.state === 'deactivated' && metadata.lifecycle?.owner === 'entra_sync';
}

function normalizeStoredEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function createUnusablePasswordHash(): Promise<string> {
  return hashPassword(`entra-sso:${randomBytes(32).toString('hex')}`);
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

export async function handleIneligibleClientPortalLifecycle(
  context: ClientPortalProvisioningContext,
  user: EntraSyncUser,
  eligibility: ClientPortalProvisioningEligibility,
  options?: { deactivateOnEntitlementRemoval?: boolean }
): Promise<ClientPortalLifecycleResult> {
  const shouldDeactivateForReason =
    eligibility.reason === 'account_disabled' ||
    (eligibility.reason === 'missing_entitlement' &&
      (options?.deactivateOnEntitlementRemoval ?? true));
  if (!shouldDeactivateForReason) {
    return { outcome: 'none' };
  }

  const reason = eligibility.reason as 'missing_entitlement' | 'account_disabled';
  return runWithTenant(context.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex.transaction(async (trx) => {
      const existing = await trx('users')
        .where({
          tenant: context.tenantId,
          user_type: 'client',
        })
        .andWhereRaw("client_portal_entra_metadata->>'managed' = 'true'")
        .andWhereRaw("client_portal_entra_metadata->>'entraTenantId' = ?", [user.entraTenantId])
        .andWhereRaw("client_portal_entra_metadata->>'entraObjectId' = ?", [user.entraObjectId])
        .orderBy('updated_at', 'desc')
        .first(['user_id', 'is_inactive', 'client_portal_entra_metadata']);

      if (!existing?.user_id) {
        return { outcome: 'none' } as ClientPortalLifecycleResult;
      }
      if (existing.is_inactive) {
        return { outcome: 'none' } as ClientPortalLifecycleResult;
      }

      const metadata = parseEntraMetadata(existing.client_portal_entra_metadata);
      const nextMetadata = {
        ...metadata,
        lifecycle: {
          state: 'deactivated',
          owner: 'entra_sync',
          reason,
          updatedAt: new Date().toISOString(),
        },
      };
      await trx('users')
        .where({
          tenant: context.tenantId,
          user_id: String(existing.user_id),
        })
        .update({
          is_inactive: true,
          client_portal_entra_metadata: nextMetadata,
          updated_at: trx.fn.now(),
        });

      return {
        outcome: 'deactivated',
        reason,
      } as ClientPortalLifecycleResult;
    });
  });
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
          .select(['user_id', 'email', 'is_inactive', 'client_portal_entra_metadata'])
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
        let matchedUserRow = existingForContact[0] ?? null;
        let attachMatchedUserToContact = false;

        if (!userId) {
          const byEmailRows = normalizedEmail
            ? await trx('users')
                .where({
                  tenant: context.tenantId,
                  user_type: 'client',
                })
                .andWhereRaw('lower(email) = ?', [normalizedEmail])
                .select(['user_id', 'contact_id', 'is_inactive', 'client_portal_entra_metadata'])
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
            matchedUserRow = byEmailRows[0];
            attachMatchedUserToContact = true;
          }
        }

        const existingMicrosoftLinkQuery = trx('user_auth_accounts')
          .where({
            tenant: context.tenantId,
            provider: 'microsoft',
            provider_account_id: user.entraObjectId,
          });
        if (userId) {
          existingMicrosoftLinkQuery.whereNot('user_id', userId);
        }

        const existingMicrosoftLink = await existingMicrosoftLinkQuery.first(['user_id']);
        if (existingMicrosoftLink?.user_id) {
          return {
            outcome: 'skipped_conflict',
            reason: 'oauth_link_conflict',
          } as ClientPortalProvisioningResult;
        }

        if (
          userId &&
          normalizedEmail &&
          normalizeStoredEmail(matchedUserRow?.email) !== normalizedEmail
        ) {
          const existingEmailOwner = await trx('users')
            .where({
              tenant: context.tenantId,
            })
            .andWhereRaw('lower(email) = ?', [normalizedEmail])
            .whereNot('user_id', userId)
            .first(['user_id']);
          if (existingEmailOwner?.user_id) {
            return {
              outcome: 'skipped_conflict',
              reason: 'email_conflict',
            } as ClientPortalProvisioningResult;
          }
        }

        if (userId && matchedUserRow) {
          const didReactivate = shouldReactivateUser(
            Boolean(matchedUserRow.is_inactive),
            matchedUserRow.client_portal_entra_metadata
          );
          const existingMetadata = parseEntraMetadata(
            matchedUserRow.client_portal_entra_metadata
          );
          await trx('users')
            .where({
              tenant: context.tenantId,
              user_id: userId,
            })
            .update({
              ...(attachMatchedUserToContact ? { contact_id: context.contactNameId } : {}),
              email: normalizedEmail || trx.raw('email'),
              username: normalizedEmail || trx.raw('username'),
              is_inactive: didReactivate ? false : trx.raw('is_inactive'),
              client_portal_entra_metadata: {
                ...entraManagedMetadata,
                lifecycle: didReactivate
                  ? {
                      state: 'active',
                      owner: 'entra_sync',
                      reason: 'entitlement_restored',
                      updatedAt: new Date().toISOString(),
                    }
                  : existingMetadata.lifecycle ?? null,
              },
              updated_at: trx.fn.now(),
            });
        }

        if (!userId) {
          const existingEmailOwner = normalizedEmail
            ? await trx('users')
                .where({
                  tenant: context.tenantId,
                })
                .andWhereRaw('lower(email) = ?', [normalizedEmail])
                .first(['user_id'])
            : null;
          if (existingEmailOwner?.user_id) {
            return {
              outcome: 'skipped_conflict',
              reason: 'email_conflict',
            } as ClientPortalProvisioningResult;
          }

          const defaultRoleName = (context.defaultRoleName || 'User').trim() || 'User';
          const roleRow = await trx('roles')
            .where({
              tenant: context.tenantId,
              client: true,
            })
            .andWhereRaw('lower(role_name) = lower(?)', [defaultRoleName])
            .first(['role_id']);
          if (!roleRow?.role_id) {
            return {
              outcome: 'skipped_conflict',
              reason: 'role_conflict',
            } as ClientPortalProvisioningResult;
          }
          const hashedPassword = await createUnusablePasswordHash();

          const inserted = await trx('users')
            .insert({
              tenant: context.tenantId,
              user_id: trx.raw('gen_random_uuid()'),
              username: normalizedEmail,
              email: normalizedEmail,
              hashed_password: hashedPassword,
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

          await trx('user_roles').insert({
            tenant: context.tenantId,
            user_id: userId,
            role_id: String(roleRow.role_id),
          });
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
        }, trx);

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
