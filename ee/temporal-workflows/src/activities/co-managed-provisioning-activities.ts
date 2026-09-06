import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { tenantDb } from '@alga-psa/db';
import { recordCoManagedProvisioningFailure } from '@alga-psa/co-managed';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import { bootstrapCoManagedWorkspace } from '../db/co-managed-provisioning-operations.js';

export interface CoManagedProvisioningWorkflowInput { sponsorTenant: string; operationId: string }

export async function bootstrapCoManagedCustomer(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  const db = await getAdminConnection();
  try {
    await bootstrapCoManagedWorkspace(db, input.sponsorTenant, input.operationId, Context.current().log);
  } catch (error) {
    await recordCoManagedProvisioningFailure(db, input.sponsorTenant, input.operationId);
    throw error;
  }
}

/** Token is loaded and consumed within this activity, never returned through a
 * workflow result, progress query, or sponsor action. Retried delivery uses the
 * same customer invitation, so a lost email response cannot create another user. */
export async function deliverCoManagedAdministratorInvitation(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  try {
    await deliverInvitation(input);
  } catch (error) {
    const db = await getAdminConnection();
    await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations')
      .where({ operation_id: input.operationId, state: 'pending_acceptance' })
      .update({ invitation_delivery_error: 'INVITATION_DELIVERY_FAILED', updated_at: db.fn.now() });
    throw error;
  }
}

async function deliverInvitation(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  const db = await getAdminConnection();
  const sponsor = tenantDb(db, input.sponsorTenant);
  const operation = await sponsor.table('co_managed_provisioning_operations').where('operation_id', input.operationId).first();
  if (!operation || operation.state !== 'pending_acceptance') throw new Error('Customer workspace is not ready for invitation delivery');
  if (operation.invitation_sent_at) return;
  const customer = tenantDb(db, operation.customer_tenant);
  const relationship = await customer.table('co_management_relationships').where('relationship_id', operation.relationship_id).first();
  if (relationship?.state === 'active') return;
  if (relationship?.state !== 'pending_acceptance') throw new Error('Customer relationship is no longer pending acceptance');
  const invitation = await db.transaction(async trx => {
    const scoped = tenantDb(trx, operation.customer_tenant);
    const pending = await scoped.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id,
      email: operation.request.administrator.email, used_at: null }).forUpdate().first();
    if (!pending) return null;
    // Failed delivery may be retried after the original window expired. Renew
    // only the unused original invitation, never an established admin account.
    if (await scoped.table('users').where({ email: pending.email, user_type: 'internal' }).first()) return null;
    await scoped.table('user_invitations').where('invitation_id', pending.invitation_id)
      .update({ expires_at: trx.raw("now() + interval '24 hours'") });
    return pending;
  });
  if (!invitation) return;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : undefined);
  if (!baseUrl) throw new Error('Base URL must be configured to deliver the customer invitation');
  const link = new URL('/auth/team/setup', baseUrl);
  link.searchParams.set('token', invitation.token);
  const owner = await sponsor.table('tenants').first('client_name');
  const sent = await sendTeamInvitationEmail({ tenant: operation.customer_tenant,
    email: invitation.email, teamMemberName: `${invitation.first_name} ${invitation.last_name}`,
    tenantName: operation.request.workspaceName, roleName: 'Admin', invitedByName: owner?.client_name || 'Your IT provider',
    inviteLink: link.toString(), expirationTime: '24 hours',
  });
  await sponsor.table('co_managed_provisioning_operations').where('operation_id', input.operationId)
    .where('state', 'pending_acceptance').update({ invitation_sent_at: sent ? db.fn.now() : null,
      invitation_delivery_error: sent ? null : 'INVITATION_DELIVERY_FAILED', updated_at: db.fn.now() });
  if (!sent) throw new Error('Customer administrator invitation could not be delivered');
}
