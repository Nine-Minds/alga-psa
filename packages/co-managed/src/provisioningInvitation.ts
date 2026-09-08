import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { lockCoManagedSeatScope, countCoManagedCommittedSeats, CoManagedAdmissionError } from '@alga-psa/licensing';
import { lockCoManagedLocalAuthentication } from './localAuthentication';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeCoManagedLocalRecord, snapshotCoManagedSessionActor, isCoManagedUuid,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

const unavailable = (): never => { throw new CoManagedSharedWorkError(); };

/** Provisioning, acceptance, cancellation and invitation recovery retain the
 * same allocation/operation/relationship lock order. No new seat is allocated. */
async function retainInvitation(trx: Knex.Transaction, sponsorTenant: string, operationId: string) {
  if (![sponsorTenant, operationId].every(isCoManagedUuid)) unavailable();
  const sponsor = tenantDb(trx, sponsorTenant);
  const found = await sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).first('customer_tenant');
  if (!found) unavailable();
  const scope = await lockCoManagedSeatScope(trx, found.customer_tenant);
  if (!scope || scope.sponsorTenant !== sponsorTenant || scope.operation.operation_id !== operationId || scope.owner?.product_code !== 'psa') unavailable();
  const { operation, relationship, allocation } = scope;
  if (operation.state !== 'pending_acceptance' || relationship.ended_at || allocation.seats < 1) unavailable();
  if (relationship.state === 'active') return null;
  if (relationship.state !== 'pending_acceptance' || allocation.state !== 'reserved') unavailable();
  const customer = tenantDb(trx, operation.customer_tenant);
  const invitation = await customer.table('user_invitations').where('invitation_id', operation.administrator_invitation_id).forUpdate().first();
  if (!invitation || invitation.email !== operation.request.administrator.email ||
      invitation.metadata?.co_managed_initial_admin !== true || invitation.metadata?.co_managed_relationship_id !== operation.relationship_id ||
      invitation.metadata?.sponsor_tenant !== sponsorTenant) unavailable();
  if (invitation.used_at || await customer.table('users').where({ user_type: 'internal' })
    .whereRaw('lower(trim(email)) = ?', [invitation.email.trim().toLowerCase()]).first('user_id')) return null;
  const role = await customer.table('roles').where({ role_id: invitation.role_id, role_name: 'Admin', msp: true, client: false }).forShare().first('role_id');
  if (!role) unavailable();
  return { sponsor, customer, operation, invitation, allocation };
}

async function assertInvitationCapacity(trx: Knex.Transaction, context: NonNullable<Awaited<ReturnType<typeof retainInvitation>>>) {
  // An expired invitation stopped reserving capacity. Renewing it is safe only
  // if the same allocation can still accommodate its original administrator.
  if (await countCoManagedCommittedSeats(trx, context.operation.customer_tenant, context.invitation.email) >= Number(context.allocation.seats))
    throw new CoManagedAdmissionError('CO_MANAGED_SEAT_LIMIT');
}

/** Explicit browser retry may replace an expired initial token only. A repeated
 * request sees the renewed token and never rotates it again or resets a login. */
export async function retryCoManagedInitialAdministratorInvitation(db: Knex, inputActor: CoManagedSessionActor, operationId: string): Promise<void> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(operationId)) unavailable();
  await db.transaction(async trx => {
    const context = await retainInvitation(trx, actor.tenant, operationId);
    if (!context) unavailable();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) unavailable();
    await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'client', 'read',
      { id: context.operation.request.clientId, clientId: context.operation.request.clientId });
    const expired = await context.customer.table('user_invitations').where('invitation_id', context.invitation.invitation_id)
      .where('expires_at', '<=', trx.raw('clock_timestamp()')).first('invitation_id');
    if (expired) {
      await assertInvitationCapacity(trx, context);
      await context.customer.table('user_invitations').where('invitation_id', context.invitation.invitation_id).update({
        token: randomBytes(32).toString('hex'), expires_at: trx.raw("clock_timestamp() + interval '24 hours'"),
      });
      await context.sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).update({
        invitation_sent_at: null, invitation_delivery_error: null, updated_at: trx.raw('clock_timestamp()'),
      });
    }
    await credential.assertCurrent();
  });
}

/** Worker-only delivery adapter. Retaining the invitation lock through send and
 * acknowledgment prevents an old send from acknowledging a replacement token. */
export async function deliverCoManagedInitialAdministratorInvitation(db: Knex, sponsorTenant: string, operationId: string,
  send: (input: { customerTenant: string; workspaceName: string; administratorName: string; email: string; token: string }) => Promise<boolean>): Promise<void> {
  const sent = await db.transaction(async trx => {
    const context = await retainInvitation(trx, sponsorTenant, operationId);
    if (!context || context.operation.invitation_sent_at) return true;
    await assertInvitationCapacity(trx, context);
    await context.customer.table('user_invitations').where('invitation_id', context.invitation.invitation_id)
      .update({ expires_at: trx.raw("clock_timestamp() + interval '24 hours'") });
    const delivered = await send({ customerTenant: context.operation.customer_tenant, workspaceName: context.operation.request.workspaceName,
      administratorName: `${context.invitation.first_name} ${context.invitation.last_name}`, email: context.invitation.email, token: context.invitation.token });
    await context.sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).update({
      invitation_sent_at: delivered ? trx.raw('clock_timestamp()') : null,
      invitation_delivery_error: delivered ? null : 'INVITATION_DELIVERY_FAILED', updated_at: trx.raw('clock_timestamp()'),
    });
    return delivered;
  });
  if (!sent) throw new Error('Customer administrator invitation could not be delivered');
}
