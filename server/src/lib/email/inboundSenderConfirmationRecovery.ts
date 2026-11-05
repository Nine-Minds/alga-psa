import type { TenantSelector } from '@alga-psa/jobs/fanout';

export const tenantsWithPendingSenderConfirmations: TenantSelector = async (db) => {
  const waiting = await db.unscoped<{ tenant: string }>(
    'co_management_deliveries',
    'sender confirmation recovery enumerates tenants with pending delivery intents',
  )
    .whereIn('delivery_kind', ['sender_confirmation', 'sender_contact_confirmation'])
    .whereIn('state', ['pending', 'failed', 'sending'])
    .distinct('tenant');
  return waiting.map((row) => ({ tenant: String(row.tenant) }));
};

/** Mailbox confirmation recovery is native email work and is not gated by co-managed participation. */
export async function recoverInboundSenderConfirmations(tenantId: string): Promise<{ sent: number; failed: number }> {
  const { deliverPendingSenderConfirmations } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
  return deliverPendingSenderConfirmations(tenantId);
}
