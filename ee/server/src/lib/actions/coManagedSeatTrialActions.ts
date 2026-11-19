'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import { coManagedBrowserActor } from '../../../../../server/src/lib/co-managed/browserActor';
import { prepareCoManagedSeatTrial, replaceCoManagedSeatTrialTechnician, resumeCoManagedSeatTrialInvitation, cancelCoManagedSeatTrial } from '../co-managed/seatTrial';

const CAPABILITY = 'co-managed-seat' as const;

async function authorize(user: { user_id: string; user_type?: string }, tenant: string, clientId: string) {
  if (user.user_type !== 'internal' || !await hasPermission(user as never, 'co_management', 'manage') ||
      !await hasPermission(user as never, 'client', 'read')) throw new Error('Permission denied');
  await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  if (!await (await createClientScopeContext(knex, tenant, user as never)).permits('client', clientId)) throw new Error('Permission denied');
  return knex;
}

async function deliver(user: { user_id: string; first_name?: string | null; last_name?: string | null; username?: string }, tenant: string,
  invitation: { email: string; firstName: string; lastName: string; token: string }) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : '');
  if (!base) return { delivered: false };
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const ownerQuery = scoped.table('tenant_companies').where({ 'tenant_companies.is_default': true })
    .select('clients.client_name').first();
  scoped.tenantJoin(ownerQuery, 'clients', 'clients.client_id', 'tenant_companies.client_id');
  const owner = await ownerQuery;
  const link = new URL('/auth/team/setup', base.endsWith('/') ? base : `${base}/`);
  link.searchParams.set('token', invitation.token);
  try {
    const result = await sendTeamInvitationEmail({ email: invitation.email, teamMemberName: `${invitation.firstName} ${invitation.lastName}`.trim(),
      tenantName: owner?.client_name ?? 'your team', roleName: 'Seat Technician',
      invitedByName: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username || '',
      inviteLink: link.toString(), expirationTime: '24 hours', tenant });
    return { delivered: result !== false };
  } catch { return { delivered: false }; }
}

export const prepareCoManagedSeatTrialAction = withAuth(async (user, { tenant }, input: {
  clientId: string; contactId: string; operationId: string; boards: Array<{ boardId: string; canCreate: boolean }>;
}) => {
  await requireCapabilityForAction(CAPABILITY, tenant, 'admits');
  const knex = await authorize(user, tenant, input.clientId);
  const result = await prepareCoManagedSeatTrial(knex, { tenant, ...input, invitedBy: user.user_id });
  return { trialId: result.trialId, arrangementId: result.arrangementId, assignmentId: result.assignmentId,
    ...(await deliver(user, tenant, result.invitation)) };
});

async function pilotClient(tenant: string, trialId: string) {
  const { knex } = await createTenantKnex(tenant);
  const pilot = await tenantDb(knex, tenant).table('co_managed_seat_trials').where({ trial_id: trialId }).first('client_id');
  if (!pilot) throw new Error('Trial not found');
  return { knex, clientId: pilot.client_id as string };
}

export const resumeCoManagedSeatTrialAction = withAuth(async (user, { tenant }, trialId: string) => {
  await requireCapabilityForAction(CAPABILITY, tenant, 'admits');
  const { clientId } = await pilotClient(tenant, trialId);
  const knex = await authorize(user, tenant, clientId);
  return { resent: true, ...(await deliver(user, tenant, await resumeCoManagedSeatTrialInvitation(knex, { tenant, trialId }))) };
});

export const replaceCoManagedSeatTrialTechnicianAction = withAuth(async (user, { tenant }, input: { trialId: string; contactId: string }) => {
  await requireCapabilityForAction(CAPABILITY, tenant, 'admits');
  const { clientId } = await pilotClient(tenant, input.trialId);
  const knex = await authorize(user, tenant, clientId);
  const result = await replaceCoManagedSeatTrialTechnician(knex, { tenant, ...input, invitedBy: user.user_id });
  return { replaced: true, ...(await deliver(user, tenant, result.invitation)) };
});

export const cancelCoManagedSeatTrialAction = withAuth(async (user, { tenant }, trialId: string) => {
  await requireCapabilityForAction(CAPABILITY, tenant, 'admits');
  const { clientId, knex } = await pilotClient(tenant, trialId);
  await authorize(user, tenant, clientId);
  return cancelCoManagedSeatTrial(knex, { tenant, trialId });
});
