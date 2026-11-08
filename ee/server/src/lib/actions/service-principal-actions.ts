'use server';

/**
 * Server actions for service principals (PRD R8, F100). Every action requires an
 * interactive internal-user session plus the `service_principal` permission for
 * the operation: a service principal can never manage service principals, and a
 * key cannot reach these actions at all. Tier, limit and lifecycle rules live in
 * the service layer; these actions only authenticate, authorize and delegate.
 */

import { withAuth, hasPermission, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { createTenantKnex } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import {
  archiveOrDeleteServicePrincipal,
  createServicePrincipal,
  getServicePrincipal,
  issueServicePrincipalKey,
  listServicePrincipalKeys,
  listServicePrincipals,
  revokeServicePrincipalKey,
  setServicePrincipalActive,
  updateServicePrincipal,
  type ArchiveOrDeleteOutcome,
  type CreateServicePrincipalInput,
  type IssuedServicePrincipalKey,
  type ServicePrincipalKeyListItem,
  type ServicePrincipalListItem,
  ServicePrincipalError,
  type ServicePrincipalRecord,
  type UpdateServicePrincipalInput,
} from '../service-principals/service';
import { rateLimitCeiling } from '../service-principals/entitlements';
import { getServicePrincipalUsage as readServicePrincipalUsage, type ServicePrincipalUsage } from '../service-principals/usage';

const RESOURCE = 'service_principal';

type Operation = 'read' | 'create' | 'update' | 'delete';

async function authorize(user: IUserWithRoles, ctx: AuthContext, action: Operation) {
  if (user.user_type !== 'internal') {
    throw new Error('Service principals can only be managed by an internal user.');
  }
  const { knex } = await createTenantKnex(ctx.tenant);
  if (!(await hasPermission(user, RESOURCE, action, knex))) {
    throw new Error(`You do not have permission to ${action} service principals.`);
  }
  return knex;
}

export const listServicePrincipalsAction = withAuth(
  async (user, ctx): Promise<ServicePrincipalListItem[]> => {
    const knex = await authorize(user, ctx, 'read');
    return listServicePrincipals(knex, ctx.tenant);
  },
);

export const getServicePrincipalAction = withAuth(
  async (user, ctx, userId: string): Promise<ServicePrincipalRecord> => {
    const knex = await authorize(user, ctx, 'read');
    return getServicePrincipal(knex, ctx.tenant, userId);
  },
);

/** F075/R7.1: limit, used and remaining for the Service Principals settings page. */
export const getServicePrincipalUsage = withAuth(async (user, ctx): Promise<ServicePrincipalUsage> => {
  const knex = await authorize(user, ctx, 'read');
  return readServicePrincipalUsage(knex, ctx.tenant);
});

export const createServicePrincipalAction = withAuth(
  async (user, ctx, input: Omit<CreateServicePrincipalInput, 'createdBy' | 'userId'>): Promise<ServicePrincipalRecord> => {
    const knex = await authorize(user, ctx, 'create');
    return createServicePrincipal(knex, ctx.tenant, { ...input, createdBy: user.user_id });
  },
);

export const updateServicePrincipalAction = withAuth(
  async (user, ctx, userId: string, input: UpdateServicePrincipalInput): Promise<ServicePrincipalRecord> => {
    const knex = await authorize(user, ctx, 'update');
    return updateServicePrincipal(knex, ctx.tenant, userId, input);
  },
);

export const setServicePrincipalActiveAction = withAuth(
  async (user, ctx, userId: string, active: boolean): Promise<void> => {
    const knex = await authorize(user, ctx, 'update');
    await setServicePrincipalActive(knex, ctx.tenant, userId, active);
  },
);

export const deleteServicePrincipalAction = withAuth(
  async (user, ctx, userId: string): Promise<ArchiveOrDeleteOutcome> => {
    const knex = await authorize(user, ctx, 'delete');
    return archiveOrDeleteServicePrincipal(knex, ctx.tenant, userId);
  },
);

export const listServicePrincipalKeysAction = withAuth(
  async (user, ctx, userId: string): Promise<ServicePrincipalKeyListItem[]> => {
    const knex = await authorize(user, ctx, 'read');
    return listServicePrincipalKeys(knex, ctx.tenant, userId);
  },
);

export const issueServicePrincipalKeyAction = withAuth(
  async (
    user,
    ctx,
    userId: string,
    options: { description?: string | null; expiresAt?: string | null } = {},
  ): Promise<IssuedServicePrincipalKey> => {
    const knex = await authorize(user, ctx, 'update');
    return issueServicePrincipalKey(knex, ctx.tenant, userId, {
      description: options.description ?? null,
      expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
    });
  },
);

export const rotateServicePrincipalKeyAction = withAuth(
  async (
    user,
    ctx,
    userId: string,
    keyId: string,
    options: { description?: string | null; expiresAt?: string | null } = {},
  ): Promise<IssuedServicePrincipalKey> => {
    const knex = await authorize(user, ctx, 'update');
    return issueServicePrincipalKey(knex, ctx.tenant, userId, {
      description: options.description ?? null,
      expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
      rotateKeyId: keyId,
    });
  },
);

export const revokeServicePrincipalKeyAction = withAuth(
  async (user, ctx, userId: string, keyId: string): Promise<void> => {
    const knex = await authorize(user, ctx, 'update');
    await revokeServicePrincipalKey(knex, ctx.tenant, userId, keyId);
  },
);

// ---------------------------------------------------------------------------
// UI view helpers (card D). The service owns the write rules; these read the
// display-only extras the Service principals tab needs (role names, last use,
// creator's display name) and set roles on an existing principal, which the
// service only supports at creation. LEVERAGE: friction service-principal-roles-update —
// roles for an existing principal belong in service.ts (updateServicePrincipal); it is wrapped here
// so card D does not edit card C's service.
// ---------------------------------------------------------------------------

export interface ServicePrincipalRow extends ServicePrincipalListItem {
  role_ids: string[];
  role_names: string[];
  last_used_at: string | null;
  created_by_name: string | null;
}

export interface MspRoleOption {
  role_id: string;
  role_name: string;
}

export const listServicePrincipalRowsAction = withAuth(async (user, ctx): Promise<ServicePrincipalRow[]> => {
  const knex = await authorize(user, ctx, 'read');
  const principals = await listServicePrincipals(knex, ctx.tenant);
  if (principals.length === 0) return [];
  const db = tenantDb(knex, ctx.tenant);
  const ids = principals.map((p) => p.user_id);

  const roleRows = (await db
    .table('user_roles')
    .join('roles', function join() {
      this.on('user_roles.role_id', 'roles.role_id').andOn('user_roles.tenant', 'roles.tenant');
    })
    .whereIn('user_roles.user_id', ids)
    .select('user_roles.user_id', 'roles.role_id', 'roles.role_name')) as Array<{
    user_id: string;
    role_id: string;
    role_name: string;
  }>;
  const lastUsed = (await db
    .table('api_keys')
    .whereIn('user_id', ids)
    .where({ purpose: 'service' })
    .groupBy('user_id')
    .select('user_id')
    .max('last_used_at as last_used_at')) as Array<{ user_id: string; last_used_at: string | null }>;
  const creatorIds = Array.from(new Set(principals.map((p) => p.created_by).filter((id): id is string => Boolean(id))));
  const creators = creatorIds.length
    ? ((await db.table('users').whereIn('user_id', creatorIds).select('user_id', 'first_name', 'last_name', 'username')) as Array<{
        user_id: string;
        first_name: string | null;
        last_name: string | null;
        username: string;
      }>)
    : [];
  const creatorName = new Map(
    creators.map((c) => [c.user_id, [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.username]),
  );
  const lastUsedBy = new Map(lastUsed.map((r) => [r.user_id, r.last_used_at]));

  return principals.map((principal) => {
    const roles = roleRows.filter((r) => r.user_id === principal.user_id);
    return {
      ...principal,
      role_ids: roles.map((r) => r.role_id),
      role_names: roles.map((r) => r.role_name).sort((a, b) => a.localeCompare(b)),
      last_used_at: lastUsedBy.get(principal.user_id) ?? null,
      created_by_name: principal.created_by ? creatorName.get(principal.created_by) ?? null : null,
    };
  });
});

/** What the create/edit dialog needs: assignable MSP roles (never client-portal roles) and the rate-limit ceiling. */
export interface ServicePrincipalFormOptions {
  roles: MspRoleOption[];
  rateLimitCeiling: { maxTokens: number; refillPerMin: number };
}

export const getServicePrincipalFormOptionsAction = withAuth(
  async (user, ctx): Promise<ServicePrincipalFormOptions> => {
    const knex = await authorize(user, ctx, 'read');
    const roles = (await tenantDb(knex, ctx.tenant)
      .table('roles')
      .where({ msp: true })
      .orderBy('role_name')
      .select('role_id', 'role_name')) as MspRoleOption[];
    return { roles, rateLimitCeiling: rateLimitCeiling() };
  },
);

export const setServicePrincipalRolesAction = withAuth(
  async (user, ctx, userId: string, roleIds: string[]): Promise<void> => {
    const knex = await authorize(user, ctx, 'update');
    // Throws SERVICE_PRINCIPAL_NOT_FOUND for an unknown or archived principal.
    const principal = await getServicePrincipal(knex, ctx.tenant, userId);
    if (principal.archived_at) {
      throw new ServicePrincipalError('SERVICE_PRINCIPAL_NOT_FOUND', 'Service principal not found', 404);
    }
    const wanted = Array.from(new Set(roleIds.filter(Boolean)));
    await knex.transaction(async (trx) => {
      const db = tenantDb(trx, ctx.tenant);
      const valid = (await db.table('roles').whereIn('role_id', wanted).where({ msp: true }).pluck('role_id')) as string[];
      if (wanted.some((id) => !valid.includes(id))) {
        throw new ServicePrincipalError('SERVICE_PRINCIPAL_ROLE_INVALID', 'Only MSP roles can be assigned', 422);
      }
      await db.table('user_roles').where({ user_id: userId }).delete();
      for (const roleId of wanted) {
        await db.table('user_roles').insert({ tenant: ctx.tenant, user_id: userId, role_id: roleId });
      }
    });
  },
);
