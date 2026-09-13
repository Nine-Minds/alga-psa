import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { tenantDb } from '@alga-psa/db';
import { recordCoManagedProvisioningFailure, deliverCoManagedInitialAdministratorInvitation, runCoManagedProvisioningCleanup, recordCoManagedProvisioningCleanupFailure } from '@alga-psa/co-managed';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import { bootstrapCoManagedWorkspace } from '../db/co-managed-provisioning-operations.js';
import { deleteCoManagedProvisioningRows } from '../db/co-managed-provisioning-cleanup.js';
import { TENANT_TABLES_DELETION_ORDER } from './tenant-deletion-activities.js';

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
    // Capacity denial is not a delivery attempt. Preserve its previous receipt
    // until the administrator frees an allocated seat and explicitly retries.
    if ((error as { code?: string })?.code === 'CO_MANAGED_SEAT_LIMIT') throw error;
    const db = await getAdminConnection();
    await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations')
      .where({ operation_id: input.operationId, state: 'pending_acceptance' })
      .update({ invitation_delivery_error: 'INVITATION_DELIVERY_FAILED', updated_at: db.fn.now() });
    if (['CO_MANAGED_NOT_ACTIVE', 'CO_MANAGED_SHARED_WORK_FORBIDDEN'].includes((error as { code?: string })?.code ?? ''))
      throw new Error('Customer relationship is no longer pending acceptance');
    throw error;
  }
}

async function deliverInvitation(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  const db = await getAdminConnection();
  const owner = await tenantDb(db, input.sponsorTenant).table('tenants').first('client_name');
  await deliverCoManagedInitialAdministratorInvitation(db, input.sponsorTenant, input.operationId, async invitation => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : undefined);
    if (!baseUrl) throw new Error('Base URL must be configured to deliver the customer invitation');
    const link = new URL('/auth/team/setup', baseUrl);
    link.searchParams.set('token', invitation.token);
    return sendTeamInvitationEmail({ tenant: invitation.customerTenant, email: invitation.email,
      teamMemberName: invitation.administratorName, tenantName: invitation.workspaceName, roleName: 'Admin',
      invitedByName: owner?.client_name || 'Your IT provider', inviteLink: link.toString(), expirationTime: '24 hours' });
  });
}

/** Cancellation is a durable database state, not a Temporal cancellation signal.
 * Existing bootstrap/invitation workers observe it under the same admission locks. */
export async function cleanupCoManagedCustomer(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  const db = await getAdminConnection();
  try {
    await runCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId,
      (trx, operation) => deleteCoManagedProvisioningRows(trx, operation, TENANT_TABLES_DELETION_ORDER));
  } catch (error) {
    await recordCoManagedProvisioningCleanupFailure(db, input.sponsorTenant, input.operationId).catch(() => undefined);
    throw error;
  }
}
