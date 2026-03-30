"use server";

import type { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { TIER_FEATURES } from '@alga-psa/types';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';

const REQUIRED_RESOURCE = 'settings';
const REQUIRED_ACTION = 'update';

export interface SsoPermissionContext {
  user: IUserWithRoles;
  tenant: string;
  knex: Knex;
}

export const ensureSsoSettingsPermission = withAuth(async (user, { tenant }): Promise<SsoPermissionContext> => {
  await assertTierAccess(TIER_FEATURES.SSO);

  const { knex } = await createTenantKnex();

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, REQUIRED_ACTION, knex);
  if (!allowed) {
    throw new Error('You do not have permission to manage security settings.');
  }

  return { user, tenant, knex };
});
