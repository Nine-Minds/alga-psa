import { createTenantKnex, runWithTenant } from '@/lib/db';
import { upsertOAuthAccountLink } from '@ee/lib/auth/oauthAccountLinks';
import type { EntraSyncUser } from './types';
import {
  handleEligibleClientPortalProvisioning,
  type ClientPortalProvisioningResult,
} from './clientPortalProvisioning';

export async function workflowCreateOrLinkClientPortalUser(params: {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  contactNameId: string;
  defaultRoleName?: string;
  user: EntraSyncUser;
}): Promise<ClientPortalProvisioningResult> {
  return handleEligibleClientPortalProvisioning(
    {
      tenantId: params.tenantId,
      clientId: params.clientId,
      managedTenantId: params.managedTenantId,
      contactNameId: params.contactNameId,
      defaultRoleName: params.defaultRoleName || 'User',
    },
    params.user
  );
}

export async function workflowAssignClientPortalRole(params: {
  tenantId: string;
  userId: string;
  roleName: string;
}): Promise<{ assigned: boolean; roleId: string | null }> {
  return runWithTenant(params.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex.transaction(async (trx) => {
      const role = await trx('roles')
        .where({ tenant: params.tenantId, client: true })
        .andWhereRaw('lower(role_name) = lower(?)', [params.roleName || 'User'])
        .first(['role_id']);
      if (!role?.role_id) {
        return { assigned: false, roleId: null };
      }

      const roleId = String(role.role_id);
      const existing = await trx('user_roles')
        .where({ tenant: params.tenantId, user_id: params.userId, role_id: roleId })
        .first(['tenant']);
      if (existing) {
        return { assigned: false, roleId };
      }

      await trx('user_roles').insert({
        tenant: params.tenantId,
        user_id: params.userId,
        role_id: roleId,
      });
      return { assigned: true, roleId };
    });
  });
}

export async function workflowUpsertMicrosoftOAuthLink(params: {
  tenantId: string;
  userId: string;
  entraObjectId: string;
  entraTenantId: string;
  managedTenantId?: string | null;
  email?: string | null;
}): Promise<void> {
  await upsertOAuthAccountLink({
    tenant: params.tenantId,
    userId: params.userId,
    provider: 'microsoft',
    providerAccountId: params.entraObjectId,
    providerEmail: params.email || null,
    metadata: {
      source: 'workflow_managed_entra',
      entraTenantId: params.entraTenantId,
      managedTenantId: params.managedTenantId || null,
    },
    lastUsedAt: new Date(),
  });
}

function parseMetadata(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

export async function workflowSetEntraManagedPortalAccessState(params: {
  tenantId: string;
  entraTenantId: string;
  entraObjectId: string;
  active: boolean;
  reason: string;
}): Promise<{ outcome: 'none' | 'deactivated' | 'reactivated' }> {
  return runWithTenant(params.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex.transaction(async (trx) => {
      const existing = await trx('users')
        .where({
          tenant: params.tenantId,
          user_type: 'client',
        })
        .andWhereRaw("client_portal_entra_metadata->>'managed' = 'true'")
        .andWhereRaw("client_portal_entra_metadata->>'entraTenantId' = ?", [params.entraTenantId])
        .andWhereRaw("client_portal_entra_metadata->>'entraObjectId' = ?", [params.entraObjectId])
        .first(['user_id', 'is_inactive', 'client_portal_entra_metadata']);

      if (!existing?.user_id) {
        return { outcome: 'none' as const };
      }

      const metadata = parseMetadata(existing.client_portal_entra_metadata);
      if (!params.active) {
        if (existing.is_inactive) {
          return { outcome: 'none' as const };
        }
        await trx('users')
          .where({ tenant: params.tenantId, user_id: String(existing.user_id) })
          .update({
            is_inactive: true,
            client_portal_entra_metadata: {
              ...metadata,
              lifecycle: {
                state: 'deactivated',
                owner: 'entra_sync',
                reason: params.reason,
                updatedAt: new Date().toISOString(),
              },
            },
            updated_at: trx.fn.now(),
          });
        return { outcome: 'deactivated' as const };
      }

      const lifecycle = metadata.lifecycle || {};
      if (!existing.is_inactive || lifecycle.owner !== 'entra_sync' || lifecycle.state !== 'deactivated') {
        return { outcome: 'none' as const };
      }

      await trx('users')
        .where({ tenant: params.tenantId, user_id: String(existing.user_id) })
        .update({
          is_inactive: false,
          client_portal_entra_metadata: {
            ...metadata,
            lifecycle: {
              state: 'active',
              owner: 'entra_sync',
              reason: params.reason,
              updatedAt: new Date().toISOString(),
            },
          },
          updated_at: trx.fn.now(),
        });
      return { outcome: 'reactivated' as const };
    });
  });
}
