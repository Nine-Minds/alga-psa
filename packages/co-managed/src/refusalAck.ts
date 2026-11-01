import { createHash } from 'node:crypto';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import { getWorkflowEmailProvider } from '@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry';
import { AUTO_GENERATED_MAIL_HEADERS } from '@shared/lib/email/automatedMessage';
import { CO_MANAGED_LEDGER, claimDelivery, finishDelivery } from '@alga-psa/shared/lib/deliveryLedger';

export const REFUSAL_ACK_KIND = 'inbound_refusal_ack';

/**
 * Acknowledgement for a refused co-managed reply token ("rejected visibly").
 *
 * The ack is a durable INTENT first: a `pending` `co_management_deliveries` row keyed by
 * (tenant, inbound_refusal_ack, hash(token), sender). Any process may record it, including
 * email-service, which has no outbound mail provider. A process that does have one sends it
 * straight away; every other process leaves the row for `deliverPendingRefusalAcks`, which the
 * co-managed recovery job runs in a process that can send. The ledger claim protocol makes the
 * send exactly-once per (token, sender): a replayed or repeated refused reply finds the row
 * already `pending`/`sending`/`sent`. The caller has already skipped RFC 3834 automated senders,
 * and the mail itself carries the auto-generated headers, so two responders cannot ping-pong.
 */
function ackKey(tenant: string, token: string, to: string) {
  const hex = createHash('sha256').update(`co-managed-refusal-ack:${tenant}:${token}`).digest('hex');
  return { delivery_kind: REFUSAL_ACK_KIND, source_id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`, recipient: to };
}

export async function recordRefusalAck(input: { tenant: string; token: string; to: string; ticketId: string }): Promise<void> {
  const db = await getAdminConnection();
  const key = ackKey(input.tenant, input.token, input.to);
  // write-admission: exempt — an inbound-mail acknowledgement intent, not a co-managed work write
  await tenantDb(db, input.tenant).table('co_management_deliveries').insert({
    tenant: input.tenant, ...key, recipient: key.recipient.trim().toLowerCase(), recipient_kind: 'requester_contact',
    state: 'pending', attempts: 0, payload: JSON.stringify({ ticketId: input.ticketId }),
  }).onConflict(['tenant', 'delivery_kind', 'source_id', 'recipient']).ignore();
}

/** @returns true when this call sent the mail. False: already handled, or no mail provider in this process. */
export async function sendRefusalAck(input: { tenant: string; token?: string; to: string; ticketId: string; sourceId?: string }): Promise<boolean> {
  let email: ReturnType<typeof getWorkflowEmailProvider>;
  try { email = getWorkflowEmailProvider(); } catch { return false; }
  const db = await getAdminConnection();
  const key = input.token ? ackKey(input.tenant, input.token, input.to) : { delivery_kind: REFUSAL_ACK_KIND, source_id: input.sourceId!, recipient: input.to };
  if (!await claimDelivery(db, CO_MANAGED_LEDGER, input.tenant, key, { recipient_kind: 'requester_contact' })) return false;
  const subject = 'Your reply could not be added to the conversation';
  const text = 'We received your reply but could not add it to the conversation it referred to. It may no longer be open to you. No further action was taken.';
  try {
    await email.TenantEmailService.getInstance(input.tenant).sendEmail({
      mailClass: 'ticket', to: input.to, tenantId: input.tenant, entityType: 'ticket', entityId: input.ticketId,
      templateProcessor: new email.StaticTemplateProcessor(subject, `<p>${text}</p>`, text),
      headers: { ...AUTO_GENERATED_MAIL_HEADERS },
    });
    await finishDelivery(db, CO_MANAGED_LEDGER, input.tenant, key, 'sent');
    return true;
  } catch (error) {
    const e = error as { message?: string; errorCode?: string; metadata?: Record<string, unknown> };
    await finishDelivery(db, CO_MANAGED_LEDGER, input.tenant, key, e.metadata?.definitelyNotSent === true ? 'failed' : 'sending',
      { error: e.message, errorCode: e.errorCode });
    throw error;
  }
}

/** Send the acknowledgements still owed in this tenant (called by the recovery job, in a process with a mail provider). */
export async function deliverPendingRefusalAcks(tenant: string, limit = 100): Promise<{ sent: number; failed: number }> {
  try { getWorkflowEmailProvider(); } catch { return { sent: 0, failed: 0 }; }
  const db = await getAdminConnection();
  const rows = await tenantDb(db, tenant).table('co_management_deliveries')
    .where({ delivery_kind: REFUSAL_ACK_KIND }).whereIn('state', ['pending', 'failed']).orderBy('created_at').limit(limit)
    .select('source_id', 'recipient', 'payload');
  let sent = 0; let failed = 0;
  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    try {
      if (await sendRefusalAck({ tenant, to: row.recipient, ticketId: String(payload?.ticketId), sourceId: row.source_id })) sent += 1;
    } catch { failed += 1; }
  }
  return { sent, failed };
}
