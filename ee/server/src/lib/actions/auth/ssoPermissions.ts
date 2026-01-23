"use server";

import type { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

const REQUIRED_RESOURCE = 'settings';
const REQUIRED_ACTION = 'update';

export interface SsoPermissionContext {
  user: IUserWithRoles;
  tenant: string;
  knex: Knex;
}

export async function ensureSsoSettingsPermission(): Promise<SsoPermissionContext> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication is required to manage SSO settings.');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, REQUIRED_ACTION, knex);
  if (!allowed) {
    throw new Error('You do not have permission to manage security settings.');
  }

  return { user, tenant, knex };
}
