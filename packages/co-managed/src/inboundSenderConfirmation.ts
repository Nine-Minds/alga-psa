import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import { getWorkflowEmailProvider } from '@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry';
import { AUTO_GENERATED_MAIL_HEADERS } from '@shared/lib/email/automatedMessage';
import { CO_MANAGED_LEDGER, claimDelivery, finishDelivery } from '@alga-psa/shared/lib/deliveryLedger';
import { coManagedDeliverySeam, coManagedInboundCommentSeam, coManagedInboundOperationId, type InboundCommentActor, type InboundCommentWrite } from '@alga-psa/shared/lib/coManagedDelivery';

const KIND = 'sender_confirmation';
const TTL_MS = 15 * 60 * 1000;
export const INBOUND_CONFIRMATION_REDEMPTION_LEASE_MS = 60_000;

type ConfirmationPayload = InboundCommentWrite & {
  actorEmail: string;
  replyToken: string;
  providerId: string;
  providerMessageId: string;
  expiresAt: string;
  contentSha256: string;
  state: 'pending' | 'redeeming' | 'approved' | 'expired';
  redemptionId?: string;
};

/** Pending requests are redeemable; interrupted claims become retryable after their lease. */
export function isInboundSenderConfirmationRedeemable(
  state: unknown,
  updatedAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (state === 'pending') return true;
  if (state !== 'redeeming' || updatedAt == null) return false;
  const claimedAt = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  return Number.isFinite(claimedAt) && claimedAt < now - INBOUND_CONFIRMATION_REDEMPTION_LEASE_MS;
}

function sourceId(tenant: string, providerId: string, messageId: string, actor: InboundCommentActor): string {
  const bytes = createHash('sha256').update([tenant, providerId, messageId, actor.tenant, actor.userId].join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function confirmationSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.APP_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('A 32-character NEXTAUTH_SECRET or APP_AUTH_SECRET is required for sender confirmation.');
  return secret;
}

function makeToken(tenant: string, id: string, expiresAt: string): string {
  const claim = Buffer.from(JSON.stringify({ tenant, sourceId: id, expiresAt }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', confirmationSecret()).update(claim).digest('base64url');
  return `${claim}.${signature}`;
}

export function parseInboundSenderConfirmationToken(token: string): { tenant: string; sourceId: string; expiresAt: string } | null {
  const [claim, signature, extra] = token.split('.');
  if (!claim || !signature || extra !== undefined) return null;
  try {
    const expected = createHmac('sha256', confirmationSecret()).update(claim).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(claim, 'base64url').toString('utf8'));
    if (typeof claims.tenant !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sourceId)
      || !Number.isFinite(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt) <= Date.now()) return null;
    return { tenant: claims.tenant, sourceId: claims.sourceId, expiresAt: claims.expiresAt };
  } catch {
    return null;
  }
}

async function sendConfirmation(tenant: string, id: string, recipient: string, payload: ConfirmationPayload): Promise<boolean> {
  if (payload.state !== 'pending') return false;
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    const db = await getAdminConnection();
    await tenantDb(db, tenant).table('co_management_deliveries')
      .where({ tenant, delivery_kind: KIND, source_id: id, recipient: recipient.trim().toLowerCase() })
      .update({ state: 'sent', payload: { ...payload, state: 'expired' }, updated_at: db.fn.now() });
    return false;
  }
  let email: ReturnType<typeof getWorkflowEmailProvider>;
  try { email = getWorkflowEmailProvider(); } catch { return false; }
  const origin = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL;
  if (!origin) return false;
  const url = new URL('/api/co-managed/inbound-confirmation', origin);
  url.searchParams.set('token', makeToken(tenant, id, payload.expiresAt));
  const subject = 'Confirm your co-managed ticket reply';
  const text = `A reply to a co-managed ticket was received using your email address. Sign in as ${recipient} and confirm it here within 15 minutes: ${url.toString()}\n\nIf you did not send this reply, ignore this message. No comment has been posted.`;
  const db = await getAdminConnection();
  const key = { delivery_kind: KIND, source_id: id, recipient: recipient.trim().toLowerCase() };
  if (!await claimDelivery(db, CO_MANAGED_LEDGER, tenant, key, { recipient_kind: payload.actor.tenant === tenant ? 'customer_user' : 'msp_user' })) return false;
  try {
    await email.TenantEmailService.getInstance(tenant).sendEmail({
      mailClass: 'ticket', to: recipient, tenantId: tenant, entityType: 'ticket', entityId: payload.ticketId,
      templateProcessor: new email.StaticTemplateProcessor(subject, `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`, text),
      headers: { ...AUTO_GENERATED_MAIL_HEADERS },
    });
    await finishDelivery(db, CO_MANAGED_LEDGER, tenant, key, 'sent');
    return true;
  } catch (error) {
    const e = error as { message?: string; errorCode?: string };
    // A repeated confirmation link is harmless: redemption is bound to an authenticated actor and
    // has an idempotent comment operation id. Retry uncertain sends instead of orphaning a request.
    await finishDelivery(db, CO_MANAGED_LEDGER, tenant, key, 'failed', { error: e.message, errorCode: e.errorCode });
    throw error;
  }
}

export async function requestInboundSenderConfirmation(input: {
  tenant: string;
  actor: InboundCommentActor;
  actorEmail: string;
  ticketId: string;
  relationshipId: string;
  threadId: string | null;
  parentCommentId: string | null;
  audience: InboundCommentWrite['audience'];
  replyToken: string;
  providerId: string;
  providerMessageId: string;
  text: string;
}): Promise<void> {
  const id = sourceId(input.tenant, input.providerId, input.providerMessageId, input.actor);
  const db = await getAdminConnection();
  const recipient = input.actorEmail.trim().toLowerCase();
  const existing = await tenantDb(db, input.tenant).table('co_management_deliveries')
    .where({ tenant: input.tenant, delivery_kind: KIND, source_id: id, recipient }).first('payload');
  let payload: ConfirmationPayload;
  if (existing?.payload) {
    payload = typeof existing.payload === 'string' ? JSON.parse(existing.payload) : existing.payload;
  } else {
    payload = {
      tenant: input.tenant, ticketId: input.ticketId, relationshipId: input.relationshipId,
      threadId: input.threadId, parentCommentId: input.parentCommentId, audience: input.audience,
      actor: input.actor, operationId: coManagedInboundOperationId(input.tenant, input.ticketId, input.providerMessageId),
      text: input.text, contentSha256: createHash('sha256').update(input.text, 'utf8').digest('hex'),
      actorEmail: recipient, replyToken: input.replyToken, providerId: input.providerId,
      providerMessageId: input.providerMessageId, expiresAt: new Date(Date.now() + TTL_MS).toISOString(), state: 'pending',
    };
    await tenantDb(db, input.tenant).table('co_management_deliveries').insert({
      tenant: input.tenant, delivery_kind: KIND, source_id: id, recipient,
      recipient_kind: input.actor.tenant === input.tenant ? 'customer_user' : 'msp_user',
      state: 'pending', attempts: 0, payload,
    }).onConflict(['tenant', 'delivery_kind', 'source_id', 'recipient']).ignore();
    const persisted = await tenantDb(db, input.tenant).table('co_management_deliveries')
      .where({ tenant: input.tenant, delivery_kind: KIND, source_id: id, recipient }).first('payload');
    if (!persisted?.payload) throw new Error('Sender confirmation request was not persisted; retry the inbound message.');
    payload = typeof persisted.payload === 'string' ? JSON.parse(persisted.payload) : persisted.payload;
  }
  await sendConfirmation(input.tenant, id, recipient, payload);
}

/** Server recovery delivery; the email-service process can safely leave the intent pending. */
export async function deliverPendingSenderConfirmations(tenant: string, limit = 100): Promise<{ sent: number; failed: number }> {
  try { getWorkflowEmailProvider(); } catch { return { sent: 0, failed: 0 }; }
  const db = await getAdminConnection();
  const rows = await tenantDb(db, tenant).table('co_management_deliveries')
    .where({ tenant, delivery_kind: KIND }).whereIn('state', ['pending', 'failed'])
    .orderBy('created_at').limit(limit).select('source_id', 'recipient', 'payload');
  let sent = 0, failed = 0;
  for (const row of rows) {
    const payload: ConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    try {
      if (await sendConfirmation(tenant, row.source_id, row.recipient, payload)) sent += 1;
    } catch { failed += 1; }
  }
  return { sent, failed };
}

/** Redeem only for the exact authenticated tenant user named by the pending reply. */
export async function approveInboundSenderConfirmation(token: string, user: {
  tenant?: string; user_id?: string; user_type?: string; email?: string | null;
}): Promise<{ ticketId: string; commentId: string } | null> {
  const claims = parseInboundSenderConfirmationToken(token);
  if (!claims || user.user_type !== 'internal') return null;
  const db = await getAdminConnection();
  const row = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: KIND, source_id: claims.sourceId })
    .first('recipient', 'payload', 'updated_at');
  if (!row?.payload) return null;
  const payload: ConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (payload.expiresAt !== claims.expiresAt || !isInboundSenderConfirmationRedeemable(payload.state, row.updated_at)
    || Date.parse(payload.expiresAt) <= Date.now()
    || user.tenant !== payload.actor.tenant || user.user_id !== payload.actor.userId
    || user.email?.trim().toLowerCase() !== String(row.recipient).trim().toLowerCase()
    || createHash('sha256').update(payload.text, 'utf8').digest('hex') !== payload.contentSha256) return null;

  // Claim redemption atomically so concurrent POSTs cannot both perform an
  // admission and comment write. A stale claim is recoverable after process
  // interruption; the stable operationId makes that retry idempotent.
  const redemptionId = randomUUID();
  const claimedPayload: ConfirmationPayload = { ...payload, state: 'redeeming', redemptionId };
  const claimed = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: KIND, source_id: claims.sourceId })
    .where((query) => query.whereRaw("payload->>'state' = 'pending'")
      .orWhere((stale) => stale.whereRaw("payload->>'state' = 'redeeming'")
        .andWhere('updated_at', '<', new Date(Date.now() - INBOUND_CONFIRMATION_REDEMPTION_LEASE_MS))))
    .update({ payload: claimedPayload, updated_at: db.fn.now() });
  if (!claimed) return null;

  let completed = false;
  try {
    const reply = await tenantDb(db, claims.tenant).table('email_reply_tokens')
      .where({ tenant: claims.tenant, token: payload.replyToken }).first('metadata');
    if (!reply) return null;
    const provider = await coManagedDeliverySeam.resolve(claims.tenant);
    if (!provider) return null;
    const admission = await provider.admitReplyToken(claims.tenant, payload.replyToken, reply.metadata, {
      email: user.email ?? null,
      internalAttributionTrusted: true,
    });
    if (!admission.admitted || !admission.actor || admission.actor.tenant !== user.tenant
      || admission.actor.userId !== user.user_id || admission.ticketId !== payload.ticketId) return null;
    const writer = await coManagedInboundCommentSeam.resolve(claims.tenant);
    if (!writer) return null;
    const result = await writer.write({
      tenant: claims.tenant,
      ticketId: admission.ticketId,
      relationshipId: admission.relationshipId,
      threadId: admission.threadId,
      parentCommentId: admission.parentCommentId,
      audience: admission.audience,
      actor: admission.actor,
      operationId: payload.operationId,
      text: payload.text,
    });
    await tenantDb(db, claims.tenant).table('co_management_deliveries')
      .where({ tenant: claims.tenant, delivery_kind: KIND, source_id: claims.sourceId })
      .whereRaw("payload->>'redemptionId' = ?", [redemptionId])
      .update({ payload: { ...payload, state: 'approved' }, updated_at: db.fn.now() });
    completed = true;
    return { ticketId: admission.ticketId, commentId: result.commentId };
  } finally {
    if (!completed) {
      await tenantDb(db, claims.tenant).table('co_management_deliveries')
        .where({ tenant: claims.tenant, delivery_kind: KIND, source_id: claims.sourceId })
        .whereRaw("payload->>'redemptionId' = ?", [redemptionId])
        .update({ payload: { ...payload, state: 'pending' }, updated_at: db.fn.now() });
    }
  }
}
