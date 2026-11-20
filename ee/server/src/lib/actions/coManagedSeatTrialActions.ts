'use server';

import { admits } from '@alga-psa/core/capability';
import { getCoManagedEntitlementState, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { readCoManagedSeatEnableState } from '@alga-psa/co-managed';
import { getStripeService } from '../stripe/StripeService';
import { admitCoManagedSponsor } from '../../../../../server/src/lib/co-managed/admitSponsor';
import { usePaidSeatForTrial, type SeatTrialQuote } from '../co-managed/seatTrialConversion';
import { reportSeatTrialMilestones } from '../co-managed/seatTrialAnalytics';
import { readCoManagedSeatTrialAdmission } from '../co-managed/seatTrial';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import { coManagedBrowserActor } from '../../../../../server/src/lib/co-managed/browserActor';
import { prepareCoManagedSeatTrial, replaceCoManagedSeatTrialTechnician, resumeCoManagedSeatTrialInvitation, cancelCoManagedSeatTrial } from '../co-managed/seatTrial';

const CAPABILITY = 'co-managed-seat' as const;

async function requireTrialIntake(tenant: string) {
  await requireCapabilityForAction(CAPABILITY, tenant, 'admits');
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) throw new Error('Trial intake is closed');
}

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
  await requireTrialIntake(tenant);
  await admitCoManagedSponsor(tenant);
  const knex = await authorize(user, tenant, input.clientId);
  await getStripeService().refreshSeatTrialBase(tenant);
  const result = await prepareCoManagedSeatTrial(knex, {
    tenant, clientId: input.clientId, contactId: input.contactId, operationId: input.operationId,
    boards: input.boards, invitedBy: user.user_id,
  });
  return { trialId: result.trialId, arrangementId: result.arrangementId, assignmentId: result.assignmentId,
    ...(result.invitation ? await deliver(user, tenant, result.invitation) : { delivered: true }) };
});

async function pilotClient(tenant: string, trialId: string) {
  const { knex } = await createTenantKnex(tenant);
  const pilot = await tenantDb(knex, tenant).table('co_managed_seat_trials').where({ trial_id: trialId }).first('client_id', 'allocation_id');
  if (!pilot) throw new Error('Trial not found');
  return { knex, clientId: pilot.client_id as string, allocationId: pilot.allocation_id as string };
}

export const resumeCoManagedSeatTrialAction = withAuth(async (user, { tenant }, trialId: string) => {
  await requireTrialIntake(tenant);
  const { clientId, allocationId } = await pilotClient(tenant, trialId);
  const knex = await authorize(user, tenant, clientId);
  return { resent: true, ...(await deliver(user, tenant, await resumeCoManagedSeatTrialInvitation(knex, { tenant, trialId, allocationId }))) };
});

export const replaceCoManagedSeatTrialTechnicianAction = withAuth(async (user, { tenant }, input: { trialId: string; contactId: string }) => {
  await requireTrialIntake(tenant);
  const { clientId, allocationId } = await pilotClient(tenant, input.trialId);
  const knex = await authorize(user, tenant, clientId);
  const result = await replaceCoManagedSeatTrialTechnician(knex, {
    tenant, allocationId, trialId: input.trialId, contactId: input.contactId, invitedBy: user.user_id,
  });
  return { replaced: true, ...(await deliver(user, tenant, result.invitation)) };
});

export const cancelCoManagedSeatTrialAction = withAuth(async (user, { tenant }, trialId: string) => {
  const { clientId, allocationId, knex } = await pilotClient(tenant, trialId);
  await authorize(user, tenant, clientId);
  return cancelCoManagedSeatTrial(knex, { tenant, trialId, allocationId });
});

/** Commercial discovery reveals no client identity without operational scope. */
export const getSeatTrialOfferAction = withAuth(async (user, { tenant }, clientId?: string) => {
  if (user.user_type !== 'internal') return null;
  await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const pilot = await db.table('co_managed_seat_trials').first();
  const intake = (await admits(CAPABILITY, tenant)).admitted && await isCoManagedPurchaseSurfaceOpen(tenant) &&
    Boolean(await db.table('co_managed_trial_sponsors').where('base_until', '>', knex.fn.now()).first('tenant'));
  if (!pilot && !intake) return null;
  if (intake) await admitCoManagedSponsor(tenant, knex);
  const canOperate = await hasPermission(user, 'co_management', 'manage') && await hasPermission(user, 'client', 'read');
  const canPurchase = await hasPermission(user, 'account_management', 'update');
  if (!canOperate && !(canPurchase && await hasPermission(user, 'account_management', 'read'))) return null;
  const reusable = pilot?.state === 'ended' && !pilot.activated_at && pilot.conversion_state !== 'pending';
  const target = clientId ?? (reusable ? undefined : pilot?.client_id);
  const permitted = canOperate && (!target || await (await createClientScopeContext(knex, tenant, user)).permits('client', target));
  if (clientId && !permitted) return null;
  if (!permitted && !canPurchase) return null;
  if (clientId && pilot && !reusable && pilot.client_id !== clientId) return null;
  if (clientId && (!pilot || reusable)) {
    const enable = await readCoManagedSeatEnableState(knex, { sponsorTenant: tenant, clientId });
    if (!enable.clientName || ['CLIENT_HAS_ARRANGEMENT','CLIENT_INACTIVE'].includes(enable.blocker ?? '')) return null;
  }
  if ((!pilot || reusable) && !intake) return null;
  // Once bound, status and recovery remain available during an intake or pricing outage.
  const price = await getStripeService().coManagedSeatPrice().catch(() => null);
  if (!price && (!pilot || reusable)) return null;
  const bound = pilot && !reusable && permitted ? pilot : null;
  const status = bound ? await readCoManagedSeatTrialAdmission(knex, { tenant, assignmentId: bound.assignment_id }) : null;
  if (bound) await reportSeatTrialMilestones(knex, tenant);
  const assignment = bound ? await db.table('co_managed_seat_assignments').where({ assignment_id: bound.assignment_id }).first('state') : null;
  return { price, intake, canStart: intake && permitted && (!pilot || reusable) && Boolean(price),
    canPurchase: Boolean(bound && canPurchase), clientId: bound?.client_id as string | undefined,
    pilot: bound && status ? { trialId: String(bound.trial_id), status: status.status,
      deadline: status.deadlineAt?.toISOString(), baseUntil: status.baseAccessUntil?.toISOString(),
      conversionFailed: bound.conversion_state === 'failed', invited: assignment?.state === 'invited', pendingPurchase: bound.conversion_state === 'pending'
        ? { operationId: String(bound.conversion_operation_id), quantity: Number(bound.quoted_quantity) } : null } : null };
});

async function billingTrial(user: Parameters<typeof authorize>[0], tenant: string, trialId: string) {
  const { clientId, allocationId } = await pilotClient(tenant, trialId);
  const knex = await authorize(user, tenant, clientId);
  if (!await hasPermission(user as never, 'account_management', 'update')) throw new Error('Permission denied');
  return { knex, allocationId };
}

export const reviewSeatTrialConversionAction = withAuth(async (user, { tenant }, trialId: string) => {
  const { knex } = await billingTrial(user, tenant, trialId);
  const pool = await getCoManagedEntitlementState(knex, tenant);
  if (pool.canGrow) return { kind: 'spare' } as const;
  const quantity = pool.capacity + 1;
  return { kind: 'purchase', quantity, ...await getStripeService().previewCoManagedSeats(tenant, quantity) } as const;
});

export const applyPaidSeatToTrialAction = withAuth(async (user, { tenant }, trialId: string) => {
  const { knex, allocationId } = await billingTrial(user, tenant, trialId);
  await usePaidSeatForTrial(knex, tenant, trialId, allocationId);
});

export const purchaseSeatForTrialAction = withAuth(async (user, { tenant }, input: {
  trialId: string; operationId: string; quantity: number; quote: SeatTrialQuote | null;
}) => {
  const { knex, allocationId } = await billingTrial(user, tenant, input.trialId);
  const bound = await tenantDb(knex, tenant).table('co_managed_seat_trials').where({ trial_id: input.trialId, allocation_id: allocationId }).first();
  const resume = bound?.conversion_operation_id === input.operationId && bound.quoted_quantity === input.quantity;
  if (!resume && (!input.quote || input.quote.quantity !== input.quantity)) throw new Error('Review the current seat price');
  if (resume && !['paid','pending'].includes(bound.conversion_state)) throw new Error('Review the seat again');
  const quote = resume ? bound.conversion_quote : input.quote;
  const service = getStripeService();
  const result = await service.purchaseCoManagedSeats(tenant, input.quantity, input.operationId, { trialId: input.trialId, allocationId, quote });
  return { ...result, publishableKey: result.kind === 'checkout' ? await service.getPublishableKey() : null };
});

export const cancelSeatTrialConversionAction = withAuth(async (user, { tenant }, trialId: string) => {
  const { knex, allocationId } = await billingTrial(user, tenant, trialId);
  const pilot = await tenantDb(knex, tenant).table('co_managed_seat_trials').where({ trial_id: trialId, allocation_id: allocationId }).first();
  if (pilot?.conversion_state === 'pending') await getStripeService().cancelSeatTrialPurchase(tenant, pilot.conversion_operation_id);
});
