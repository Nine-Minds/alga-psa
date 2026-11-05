import { defineJob, type JobDescriptorTenantSelector } from '@alga-psa/jobs/fanout';
import { getAdminConnection } from '@alga-psa/db';

export const INBOUND_SENDER_CONFIRMATION_RECOVERY_JOB = 'inbound-sender-confirmation-recovery';

export const tenantsWithPendingSenderConfirmations: JobDescriptorTenantSelector = async (db) => {
  const waiting = await db.unscoped<{ tenant: string }>(
    'co_management_deliveries',
    'sender confirmation recovery enumerates tenants with pending delivery intents',
  )
    .whereIn('delivery_kind', ['sender_confirmation', 'sender_contact_confirmation'])
    .whereIn('state', ['pending', 'failed', 'sending'])
    .distinct('tenant');
  return waiting.map((row) => ({ tenant: String(row.tenant) }));
};

let defined = false;
/** Mailbox confirmation recovery is native email work and is not gated by co-managed participation. */
export function defineInboundSenderConfirmationRecoveryJob(): void {
  if (defined) return;
  defined = true;
  defineJob({
    name: INBOUND_SENDER_CONFIRMATION_RECOVERY_JOB,
    scope: 'tenant',
    schedule: { cron: '*/5 * * * *' },
    tenants: tenantsWithPendingSenderConfirmations,
    run: async (tenantId) => {
      const { deliverPendingSenderConfirmations } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
      return deliverPendingSenderConfirmations(tenantId);
    },
  });
}
