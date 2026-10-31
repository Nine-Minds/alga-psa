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
  type ServicePrincipalRecord,
  type UpdateServicePrincipalInput,
} from '../service-principals/service';
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
