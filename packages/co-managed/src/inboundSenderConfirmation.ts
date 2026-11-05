import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import { getWorkflowEmailProvider } from '@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry';
import { AUTO_GENERATED_MAIL_HEADERS } from '@shared/lib/email/automatedMessage';
import { inboundMessageSha256 } from '@alga-psa/shared/lib/email/inboundMessageDigest';
import { CO_MANAGED_LEDGER, claimDelivery } from '@alga-psa/shared/lib/deliveryLedger';
import { coManagedDeliverySeam, coManagedInboundCommentSeam, coManagedInboundOperationId, type InboundCommentActor, type InboundCommentWrite } from '@alga-psa/shared/lib/coManagedDelivery';

const KIND = 'sender_confirmation';
const CONTACT_KIND = 'sender_contact_confirmation';
const TTL_MS = 15 * 60 * 1000;
export const INBOUND_CONFIRMATION_REDEMPTION_LEASE_MS = 60_000;
export const INBOUND_CONFIRMATION_SEND_LEASE_MS = 60_000;

type ConfirmationPayload = InboundCommentWrite & {
  actorEmail: string;
  replyToken: string;
  providerId: string;
  providerMessageId: string;
  expiresAt: string;
  contentSha256: string;
  state: 'pending' | 'redeeming' | 'approved' | 'expired';
  redemptionId?: string;
  deliveryAttemptId?: string;
};

type ConfirmationSendOutcome = 'sent' | 'failed' | 'skipped';
type ContactConfirmationPayload = {
  tenant: string; contactId: string; contactEmail: string; ticketId: string; providerId: string;
  providerMessageId: string; emailData: import('@alga-psa/shared/interfaces/inbound-email.interfaces').EmailMessageDetails;
  contentSha256: string; expiresAt: string; state: 'pending' | 'redeeming' | 'approved' | 'expired'; redemptionId?: string;
  deliveryAttemptId?: string;
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

async function claimSenderConfirmation(tenant: string, id: string, recipient: string, payload: ConfirmationPayload): Promise<string | null> {
  const db = await getAdminConnection();
  const key = { delivery_kind: KIND, source_id: id, recipient: recipient.trim().toLowerCase() };
  const attemptId = randomUUID();
  return db.transaction(async (trx) => {
    if (!await claimDelivery(trx, CO_MANAGED_LEDGER, tenant, key, { recipient_kind: payload.actor.tenant === tenant ? 'customer_user' : 'msp_user' })) return null;
    const row = await tenantDb(trx, tenant).table('co_management_deliveries')
      .where({ tenant, ...key, state: 'sending' }).first('payload');
    if (!row?.payload) throw new Error('Claimed sender confirmation has no persisted payload.');
    const existing = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    await tenantDb(trx, tenant).table('co_management_deliveries')
      .where({ tenant, ...key, state: 'sending' })
      .update({ payload: { ...existing, deliveryAttemptId: attemptId }, updated_at: trx.fn.now() });
    return attemptId;
  });
}

async function finishSenderConfirmation(
  tenant: string,
  id: string,
  recipient: string,
  attemptId: string,
  state: 'sent' | 'failed',
  error?: string,
  errorCode?: string,
): Promise<boolean> {
  const db = await getAdminConnection();
  return (await tenantDb(db, tenant).table('co_management_deliveries')
    .where({ tenant, delivery_kind: KIND, source_id: id, recipient: recipient.trim().toLowerCase(), state: 'sending' })
    .whereRaw("payload->>'deliveryAttemptId' = ?", [attemptId])
    .update({ state, updated_at: db.fn.now(), last_error: error ?? null, error_code: errorCode ?? null, requires_reconciliation: false })) > 0;
}

async function recoverStaleSenderConfirmationClaims(tenant: string): Promise<number> {
  const db = await getAdminConnection();
  const staleBefore = new Date(Date.now() - INBOUND_CONFIRMATION_SEND_LEASE_MS);
  return tenantDb(db, tenant).table('co_management_deliveries')
    .whereIn('delivery_kind', [KIND, CONTACT_KIND]).where({ tenant, state: 'sending', requires_reconciliation: false })
    .where('updated_at', '<', staleBefore)
    .update({ state: 'failed', updated_at: db.fn.now(), error_code: 'sender_confirmation_send_interrupted',
      last_error: 'Sender confirmation send claim expired before finalization; safe retry uses the same expiring confirmation token.',
      requires_reconciliation: false });
}

async function sendConfirmation(tenant: string, id: string, recipient: string, payload: ConfirmationPayload): Promise<ConfirmationSendOutcome> {
  if (payload.state !== 'pending') return 'skipped';
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    const db = await getAdminConnection();
    await tenantDb(db, tenant).table('co_management_deliveries')
      .where({ tenant, delivery_kind: KIND, source_id: id, recipient: recipient.trim().toLowerCase() })
      .update({ state: 'sent', payload: { ...payload, state: 'expired' }, updated_at: db.fn.now() });
    return 'skipped';
  }
  let email: ReturnType<typeof getWorkflowEmailProvider>;
  try { email = getWorkflowEmailProvider(); } catch { return 'skipped'; }
  const origin = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL;
  if (!origin) return 'skipped';
  const url = new URL('/api/co-managed/inbound-confirmation', origin);
  url.searchParams.set('token', makeToken(tenant, id, payload.expiresAt));
  const subject = 'Confirm your co-managed ticket reply';
  const text = `A reply to a co-managed ticket was received using your email address. Sign in as ${recipient} and confirm it here within 15 minutes: ${url.toString()}\n\nIf you did not send this reply, ignore this message. No comment has been posted.`;
  const attemptId = await claimSenderConfirmation(tenant, id, recipient, payload);
  if (!attemptId) return 'skipped';
  try {
    const result = await email.TenantEmailService.getInstance(tenant).sendEmail({
      mailClass: 'ticket', to: recipient, tenantId: tenant, entityType: 'ticket', entityId: payload.ticketId,
      templateProcessor: new email.StaticTemplateProcessor(subject, `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`, text),
      headers: { ...AUTO_GENERATED_MAIL_HEADERS },
    });
    if (!result?.success) {
      await finishSenderConfirmation(tenant, id, recipient, attemptId, 'failed', result?.error || 'Email provider reported delivery failure.',
        String((result as any)?.metadata?.errorCode ?? result?.providerId ?? 'email_send_failed'));
      return 'failed';
    }
    await finishSenderConfirmation(tenant, id, recipient, attemptId, 'sent');
    return 'sent';
  } catch (error) {
    const e = error as { message?: string; errorCode?: string };
    // A repeated confirmation link is harmless: redemption is bound to an authenticated actor and
    // has an idempotent comment operation id. Retry uncertain sends instead of orphaning a request.
    await finishSenderConfirmation(tenant, id, recipient, attemptId, 'failed', e.message, e.errorCode);
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

/** Queue a one-time mailbox-possession confirmation for a registered ticket contact. */
export async function requestInboundContactSenderConfirmation(input: {
  tenant: string; contactId: string; contactEmail: string; ticketId: string; providerId: string;
  providerMessageId: string; emailData: import('@alga-psa/shared/interfaces/inbound-email.interfaces').EmailMessageDetails;
}): Promise<void> {
  const recipient = input.contactEmail.trim().toLowerCase();
  const digest = inboundMessageSha256(input.emailData);
  const id = sourceId(input.tenant, input.providerId, input.providerMessageId, { tenant: input.tenant, userId: input.contactId });
  const db = await getAdminConnection();
  const payload: ContactConfirmationPayload = {
    ...input, contactEmail: recipient, contentSha256: digest,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(), state: 'pending',
  };
  await tenantDb(db, input.tenant).table('co_management_deliveries').insert({
    tenant: input.tenant, delivery_kind: CONTACT_KIND, source_id: id, recipient, recipient_kind: 'requester_contact',
    state: 'pending', attempts: 0, payload,
  }).onConflict(['tenant', 'delivery_kind', 'source_id', 'recipient']).ignore();
  const row = await tenantDb(db, input.tenant).table('co_management_deliveries')
    .where({ tenant: input.tenant, delivery_kind: CONTACT_KIND, source_id: id, recipient }).first('payload');
  if (!row?.payload) throw new Error('Contact confirmation request was not persisted.');
  const stored: ContactConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (stored.state !== 'pending' || stored.contentSha256 !== digest) return;
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    await tenantDb(db, input.tenant).table('co_management_deliveries').where({ tenant: input.tenant, delivery_kind: CONTACT_KIND, source_id: id, recipient })
      .update({ state: 'sent', payload: { ...stored, state: 'expired' }, updated_at: db.fn.now() });
    return;
  }
  let attemptId: string | undefined;
  try {
    const email = getWorkflowEmailProvider();
    const origin = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL;
    if (!origin) return;
    const url = new URL('/api/co-managed/inbound-confirmation', origin);
    url.searchParams.set('token', makeToken(input.tenant, id, stored.expiresAt));
    const text = `A reply to ticket ${input.ticketId} was received using your email address. Open this link and confirm only if you wrote it: ${url.toString()}\n\n${input.emailData.body?.text ?? ''}`;
    const currentAttemptId = randomUUID();
    attemptId = currentAttemptId;
    const claimed = await db.transaction(async (trx) => {
      const key = { delivery_kind: CONTACT_KIND, source_id: id, recipient };
      if (!await claimDelivery(trx, CO_MANAGED_LEDGER, input.tenant, key, { recipient_kind: 'requester_contact' })) return false;
      const latest = await tenantDb(trx, input.tenant).table('co_management_deliveries').where({ tenant: input.tenant, ...key, state: 'sending' }).first('payload');
      if (!latest?.payload) throw new Error('Claimed contact confirmation has no persisted payload.');
      const current = typeof latest.payload === 'string' ? JSON.parse(latest.payload) : latest.payload;
      await tenantDb(trx, input.tenant).table('co_management_deliveries').where({ tenant: input.tenant, ...key, state: 'sending' })
        .update({ payload: { ...current, deliveryAttemptId: currentAttemptId }, updated_at: trx.fn.now() });
      return true;
    });
    if (!claimed) return;
    const result = await email.TenantEmailService.getInstance(input.tenant).sendEmail({
      mailClass: 'ticket', to: recipient, tenantId: input.tenant, entityType: 'ticket', entityId: input.ticketId,
      templateProcessor: new email.StaticTemplateProcessor('Confirm your ticket reply', `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`, text),
      headers: { ...AUTO_GENERATED_MAIL_HEADERS },
    });
    await tenantDb(db, input.tenant).table('co_management_deliveries').where({ tenant: input.tenant, delivery_kind: CONTACT_KIND, source_id: id, recipient, state: 'sending' })
      .whereRaw("payload->>'deliveryAttemptId' = ?", [currentAttemptId])
      .update({ state: result?.success ? 'sent' : 'failed', error_code: result?.success ? null : String((result as any)?.metadata?.errorCode ?? 'email_send_failed'), last_error: result?.success ? null : result?.error ?? 'Email provider reported delivery failure.', updated_at: db.fn.now() });
  } catch (error) {
    if (attemptId) await tenantDb(db, input.tenant).table('co_management_deliveries').where({ tenant: input.tenant, delivery_kind: CONTACT_KIND, source_id: id, recipient, state: 'sending' })
      .whereRaw("payload->>'deliveryAttemptId' = ?", [attemptId])
      .update({ state: 'failed', error_code: 'email_send_failed', last_error: error instanceof Error ? error.message : String(error), updated_at: db.fn.now() });
    throw error;
  }
}

export async function loadInboundContactConfirmation(claims: { tenant: string; sourceId: string; expiresAt: string }) {
  const db = await getAdminConnection();
  const row = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: CONTACT_KIND, source_id: claims.sourceId }).first('recipient', 'payload', 'updated_at');
  if (!row?.payload) return null;
  const payload: ContactConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (payload.expiresAt !== claims.expiresAt || payload.contactEmail !== String(row.recipient).trim().toLowerCase()
    || Date.parse(payload.expiresAt) <= Date.now() || !isInboundSenderConfirmationRedeemable(payload.state, row.updated_at)) return null;
  return { row, payload };
}

export async function approveInboundContactSenderConfirmation(token: string): Promise<unknown | null> {
  const claims = parseInboundSenderConfirmationToken(token);
  if (!claims) return null;
  const pending = await loadInboundContactConfirmation(claims);
  if (!pending || pending.payload.tenant !== claims.tenant || pending.payload.emailData.tenant !== claims.tenant
    || pending.payload.emailData.providerId !== pending.payload.providerId
    || (pending.payload.emailData.providerIdentity || pending.payload.emailData.id) !== pending.payload.providerMessageId
    || sourceId(claims.tenant, pending.payload.providerId, pending.payload.providerMessageId,
      { tenant: claims.tenant, userId: pending.payload.contactId }) !== claims.sourceId
    || inboundMessageSha256(pending.payload.emailData) !== pending.payload.contentSha256) return null;
  const db = await getAdminConnection();
  const redemptionId = randomUUID();
  const claimed = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: CONTACT_KIND, source_id: claims.sourceId })
    .where((q) => q.whereRaw("payload->>'state' = 'pending'").orWhere((stale) => stale.whereRaw("payload->>'state' = 'redeeming'").andWhere('updated_at', '<', new Date(Date.now() - INBOUND_CONFIRMATION_REDEMPTION_LEASE_MS))))
    .update({ payload: { ...pending.payload, state: 'redeeming', redemptionId }, updated_at: db.fn.now() });
  if (!claimed) return null;
  try {
    const process = await import('../../../shared/services/email/processInboundEmailInApp');
    const result = await process.processInboundEmailInApp({ tenantId: claims.tenant, providerId: pending.payload.providerId, emailData: pending.payload.emailData }, {
      confirmedContact: { contactId: pending.payload.contactId, email: pending.payload.contactEmail, contentSha256: pending.payload.contentSha256 },
    });
    if (!['replied', 'deduped'].includes((result as any).outcome) || (result as any).ticketId !== pending.payload.ticketId) return null;
    await tenantDb(db, claims.tenant).table('co_management_deliveries').where({ tenant: claims.tenant, delivery_kind: CONTACT_KIND, source_id: claims.sourceId })
      .whereRaw("payload->>'redemptionId' = ?", [redemptionId]).update({ payload: { ...pending.payload, state: 'approved' }, updated_at: db.fn.now() });
    return result;
  } finally {
    await tenantDb(db, claims.tenant).table('co_management_deliveries').where({ tenant: claims.tenant, delivery_kind: CONTACT_KIND, source_id: claims.sourceId })
      .whereRaw("payload->>'redemptionId' = ?", [redemptionId]).whereRaw("payload->>'state' = 'redeeming'")
      .update({ payload: { ...pending.payload, state: 'pending' }, updated_at: db.fn.now() });
  }
}

/** Server recovery delivery; the email-service process can safely leave the intent pending. */
export async function deliverPendingSenderConfirmations(tenant: string, limit = 100): Promise<{ sent: number; failed: number }> {
  try { getWorkflowEmailProvider(); } catch { return { sent: 0, failed: 0 }; }
  const db = await getAdminConnection();
  await recoverStaleSenderConfirmationClaims(tenant);
  const rows = await tenantDb(db, tenant).table('co_management_deliveries')
    .where({ tenant }).whereIn('delivery_kind', [KIND, CONTACT_KIND]).whereIn('state', ['pending', 'failed'])
    .orderBy('created_at').limit(limit).select('delivery_kind', 'source_id', 'recipient', 'payload');
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      if (row.delivery_kind === CONTACT_KIND) {
        const payload: ContactConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        await requestInboundContactSenderConfirmation({ tenant, contactId: payload.contactId, contactEmail: payload.contactEmail,
          ticketId: payload.ticketId, providerId: payload.providerId, providerMessageId: payload.providerMessageId, emailData: payload.emailData });
        const current = await tenantDb(db, tenant).table('co_management_deliveries')
          .where({ tenant, delivery_kind: CONTACT_KIND, source_id: row.source_id, recipient: row.recipient }).first('state');
        if (current?.state === 'sent') sent += 1; else if (current?.state === 'failed') failed += 1;
      } else {
        const payload: ConfirmationPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        const result = await sendConfirmation(tenant, row.source_id, row.recipient, payload);
        if (result === 'sent') sent += 1;
        else if (result === 'failed') failed += 1;
      }
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
