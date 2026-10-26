'use server';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { isCoManagedLifecycleError } from '@alga-psa/licensing';
import { CoManagedDelegationError, CoManagedSharedWorkError, isCoManagedUuid, resolveCoManagedManagementTarget,
  type CoManagedManagementSelector } from '@alga-psa/co-managed';
import { getCoManagedDelegatedScreen, saveCoManagedDelegatedGrant, revokeCoManagedDelegatedGrant, searchCoManagedDelegatedOptions,
  executeCoManagedDelegatedCommand, listCoManagedDelegatedWorkspaces, type CoManagedDelegatedGrantInput, type CoManagedDelegatedCommand, type CoManagedDelegatedOperation } from '@alga-psa/co-managed';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import type { Knex } from 'knex';
import type { CoManagedSessionActor } from '@alga-psa/co-managed';

/** A legacy provisioning operation ID is a compatibility selector; the normal
 * interface is the explicit customer-home or sponsor-client selector. */
export type CoManagedDelegationTargetInput = string | CoManagedManagementSelector | undefined;

async function target(db: Knex, actor: CoManagedSessionActor, input: CoManagedDelegationTargetInput) {
  if (input !== undefined && typeof input !== 'string') {
    const resolution = await resolveCoManagedManagementTarget(db, actor, input);
    if (resolution.kind !== 'resolved') throw new CoManagedSharedWorkError();
    return { customerTenant: resolution.target.customerTenant, relationshipId: resolution.target.relationshipId };
  }
  const operationId = input;
  const own = tenantDb(db,actor.tenant), workspace = await own.table('tenants').first('product_code');
  if (workspace?.product_code === 'co_managed' && operationId === undefined) {
    const relationship = await own.table('co_management_relationships').whereNull('ended_at').first('relationship_id');
    if (relationship) return { customerTenant: actor.tenant, relationshipId: relationship.relationship_id as string };
  }
  if (workspace?.product_code === 'psa' && isCoManagedUuid(operationId)) {
    const operation = await own.table('co_managed_provisioning_operations').where('operation_id',operationId).first('customer_tenant','relationship_id');
    if (operation) return { customerTenant: operation.customer_tenant as string, relationshipId: operation.relationship_id as string };
  }
  throw new CoManagedSharedWorkError();
}
export const getCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input?: CoManagedDelegationTargetInput) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  const own = await tenantDb(knex,tenant).table('tenants').first('product_code');
  if (own?.product_code === 'psa' && input === undefined) return { side: 'directory' as const, workspaces: await listCoManagedDelegatedWorkspaces(knex,actor) };
  return getCoManagedDelegatedScreen(knex,actor,await target(knex,actor,input));
});
export const searchCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { kind: 'principal' | CoManagedDelegatedOperation; selector?: CoManagedManagementSelector; search?: string; page?: number }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  return searchCoManagedDelegatedOptions(knex,actor,await target(knex,actor,input.selector),input);
});
export const grantCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { revision: number; grant: CoManagedDelegatedGrantInput; selector?: CoManagedManagementSelector }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  return saveCoManagedDelegatedGrant(knex,actor,await target(knex,actor,input.selector),input.revision,input.grant);
});
export const revokeCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { revision: number; grantId: string; selector?: CoManagedManagementSelector }) => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  return revokeCoManagedDelegatedGrant(knex,actor,await target(knex,actor,input.selector),input.revision,input.grantId);
});
/** Production server actions mask thrown messages, so every refusal the editor must name is returned as a code.
 * Only an outcome the server cannot know (a lost response, a failure around COMMIT) stays `unknownOutcome`. */
export type CoManagedDelegatedRunResult = { ok: true; completed: true } |
  { ok: false; code: 'revoked' | 'targetChanged' | 'deliveryFailed' | 'readOnly' | 'forbidden' | 'unknownOutcome' };
const delegationRefusals = { CO_MANAGED_DELEGATION_REVOKED: 'revoked', CO_MANAGED_DELEGATION_TARGET_CHANGED: 'targetChanged',
  CO_MANAGED_DELEGATION_DELIVERY_FAILED: 'deliveryFailed' } as const;
export const runCoManagedDelegatedAdministration = withAuth(async (user,{ tenant }, input: { operationId: string; command: CoManagedDelegatedCommand; selector?: CoManagedManagementSelector }): Promise<CoManagedDelegatedRunResult> => {
  const actor = await coManagedBrowserActor(user,tenant), { knex } = await createTenantKnex(tenant);
  if (!input) throw new CoManagedSharedWorkError();
  try {
    await runDelegatedCommand(knex, actor, input);
    return { ok: true, completed: true };
  } catch (error) {
    if (error instanceof CoManagedDelegationError) return { ok: false, code: delegationRefusals[error.code] };
    if (isCoManagedLifecycleError(error)) return { ok: false, code: 'readOnly' };
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    return { ok: false, code: 'unknownOutcome' };
  }
});
async function runDelegatedCommand(knex: Knex, actor: CoManagedSessionActor, input: { operationId: string; command: CoManagedDelegatedCommand; selector?: CoManagedManagementSelector }) {
  return executeCoManagedDelegatedCommand(knex,actor,await target(knex,actor,input.selector ?? input.operationId),input.command,async invitation => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL;
    if (!base) throw new Error('Invitation URL is not configured');
    const link = new URL('/auth/team/setup',base); link.searchParams.set('token',invitation.token);
    return sendTeamInvitationEmail({ tenant: invitation.customerTenant, email: invitation.email, teamMemberName: invitation.name,
      tenantName: invitation.workspaceName, roleName: invitation.roleName, invitedByName: invitation.invitedByName, inviteLink: link.toString(),
      expirationTime: `${Math.max(1,Math.ceil((new Date(invitation.expiresAt).getTime()-Date.now())/60000))} minutes` });
  });
}
