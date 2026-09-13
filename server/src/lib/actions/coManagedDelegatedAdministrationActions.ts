'use server';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { CoManagedSharedWorkError, isCoManagedUuid } from '@alga-psa/co-managed';
import { getCoManagedDelegatedScreen, saveCoManagedDelegatedGrant, revokeCoManagedDelegatedGrant, searchCoManagedDelegatedOptions,
  executeCoManagedDelegatedCommand, listCoManagedDelegatedWorkspaces, type CoManagedDelegatedGrantInput, type CoManagedDelegatedCommand, type CoManagedDelegatedOperation } from '@alga-psa/co-managed';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import type { Knex } from 'knex';
async function target(db: Knex, tenant: string, operationId?: string) {
  const own = tenantDb(db,tenant), workspace = await own.table('tenants').first('product_code');
  if (workspace?.product_code === 'co_managed' && operationId === undefined) {
    const relationship = await own.table('co_management_relationships').whereNull('ended_at').first('relationship_id');
    if (relationship) return { customerTenant: tenant, relationshipId: relationship.relationship_id as string };
  }
  if (workspace?.product_code === 'psa' && isCoManagedUuid(operationId)) {
    const operation = await own.table('co_managed_provisioning_operations').where('operation_id',operationId).first('customer_tenant','relationship_id');
    if (operation) return { customerTenant: operation.customer_tenant as string, relationshipId: operation.relationship_id as string };
  }
  throw new CoManagedSharedWorkError();
}
export const getCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, operationId?: string) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  const own = await tenantDb(knex,tenant).table('tenants').first('product_code');
  if (own?.product_code === 'psa' && operationId === undefined) return { side: 'directory' as const, workspaces: await listCoManagedDelegatedWorkspaces(knex,actor) };
  return getCoManagedDelegatedScreen(knex,actor,await target(knex,tenant,operationId));
});
export const searchCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { kind: 'principal' | CoManagedDelegatedOperation; search?: string; page?: number }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  return searchCoManagedDelegatedOptions(knex,actor,await target(knex,tenant),input);
});
export const grantCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { revision: number; grant: CoManagedDelegatedGrantInput }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  return saveCoManagedDelegatedGrant(knex,actor,await target(knex,tenant),input.revision,input.grant);
});
export const revokeCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { revision: number; grantId: string }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  return revokeCoManagedDelegatedGrant(knex,actor,await target(knex,tenant),input.revision,input.grantId);
});
export const runCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { operationId: string; command: CoManagedDelegatedCommand }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  return executeCoManagedDelegatedCommand(knex,actor,await target(knex,tenant,input.operationId),input.command,async invitation => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL;
    if (!base) throw new Error('Invitation URL is not configured');
    const link = new URL('/auth/team/setup',base); link.searchParams.set('token',invitation.token);
    return sendTeamInvitationEmail({ tenant: invitation.customerTenant, email: invitation.email, teamMemberName: invitation.name,
      tenantName: invitation.workspaceName, roleName: invitation.roleName, invitedByName: invitation.invitedByName, inviteLink: link.toString(),
      expirationTime: `${Math.max(1,Math.ceil((new Date(invitation.expiresAt).getTime()-Date.now())/60000))} minutes` });
  });
});
