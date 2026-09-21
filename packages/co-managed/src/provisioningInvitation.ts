import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { lockCoManagedSeatScope, countCoManagedCommittedSeats, CoManagedAdmissionError } from '@alga-psa/licensing';
import { lockCoManagedLocalAuthentication } from './localAuthentication';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeCoManagedLocalRecord, snapshotCoManagedSessionActor, isCoManagedUuid,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

const unavailable: () => never = () => { throw new CoManagedSharedWorkError(); };

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
        token: randomBytes(32).toString('hex'), expires_at: trx.raw("now() + interval '24 hours'"),
      });
      await context.sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).update({
        invitation_sent_at: null, invitation_delivery_error: null, updated_at: trx.raw('now()'),
      });
    }
    await credential.assertCurrent();
  });
}

/** Worker-only delivery adapter. The send must not run inside the retaining
 * transaction. Retaining takes `FOR UPDATE` on the customer `tenants` row (seat
 * scope admission), while the mail path writes `email_sending_logs` on its own
 * pooled connection, and that insert's foreign key needs `KEY SHARE` on the same
 * row. Each then waits on the other, and Postgres cannot break the cycle because
 * the retaining side is idle in transaction waiting on its client rather than
 * blocked on a lock: the send never returns, the activity burns its timeout, and
 * its retry sends the mail a second time.
 *
 * The token identity that holding the lock used to protect is enforced by
 * comparison instead. Phase one retains the invitation and reads the exact token;
 * the send runs with no transaction open; phase three re-reads the invitation
 * under its own short lock and acknowledges only if the stored token is still the
 * one that was sent. An old send meeting a replacement token finds them
 * different and drops its acknowledgment -- success and failure alike, since
 * neither describes the token now outstanding. */
export async function deliverCoManagedInitialAdministratorInvitation(db: Knex, sponsorTenant: string, operationId: string,
  send: (input: { customerTenant: string; workspaceName: string; administratorName: string; email: string; token: string }) => Promise<boolean>): Promise<void> {
  const prepared = await db.transaction(async trx => {
    const context = await retainInvitation(trx, sponsorTenant, operationId);
    if (!context || context.operation.invitation_sent_at) return null;
    await assertInvitationCapacity(trx, context);
    await context.customer.table('user_invitations').where('invitation_id', context.invitation.invitation_id)
      .update({ expires_at: trx.raw("now() + interval '24 hours'") });
    return { customerTenant: context.operation.customer_tenant as string, workspaceName: context.operation.request.workspaceName as string,
      administratorName: `${context.invitation.first_name} ${context.invitation.last_name}`, email: context.invitation.email as string,
      token: context.invitation.token as string, invitationId: context.invitation.invitation_id as string };
  });
  if (!prepared) return;

  // No transaction is open across this call, by design. See above.
  const delivered = await send({ customerTenant: prepared.customerTenant, workspaceName: prepared.workspaceName,
    administratorName: prepared.administratorName, email: prepared.email, token: prepared.token });

  const acknowledged = await db.transaction(async trx => {
    // Retain again rather than reading the invitation row directly: acknowledging
    // takes the same locks in the same order as every other invitation path
    // (sponsor scope, then the customer invitation). Locking the invitation first
    // here inverts that order against a concurrent recovery, which holds the
    // operation row and wants the invitation -- a genuine deadlock, and one
    // Postgres does report.
    const context = await retainInvitation(trx, sponsorTenant, operationId);
    if (!context || context.invitation.token !== prepared.token) return false;
    await context.sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).update({
      invitation_sent_at: delivered ? trx.raw('now()') : null,
      invitation_delivery_error: delivered ? null : 'INVITATION_DELIVERY_FAILED', updated_at: trx.raw('now()'),
    });
    return true;
  });
  if (!acknowledged) return;
  if (!delivered) throw new Error('Customer administrator invitation could not be delivered');
}
