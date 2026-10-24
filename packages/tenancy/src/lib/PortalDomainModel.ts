import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  getKnexForTenant,
  getPortalDomain,
  upsertPortalDomain,
  type PortalDomain,
  type UpsertPortalDomainInput,
} from './PortalDomainStore';

export * from './PortalDomainStore';

export const getCurrentTenantPortalDomain = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext): Promise<PortalDomain | null> => {
  const { knex } = await getKnexForTenant(tenant);
  return getPortalDomain(knex, tenant);
});

export const upsertCurrentTenantPortalDomain = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, input: UpsertPortalDomainInput): Promise<PortalDomain> => {
  const { knex } = await getKnexForTenant(tenant);
  return upsertPortalDomain(knex, tenant, input);
});
