import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import type { WorkflowActor } from 'server/src/lib/eventBus/publishers';
import {
  buildEmailBouncedPayload,
  buildEmailComplaintReceivedPayload,
  buildEmailDeliveredPayload,
  buildEmailUnsubscribedPayload,
} from '@shared/workflow/streams/domainEventBuilders/emailFeedbackEventBuilders';

type ResendWebhookEvent = {
  type?: string;
  created_at?: string;
  data?: Record<string, any>;
};

export type ResendWorkflowEventToPublish = {
  eventType: 'EMAIL_DELIVERED' | 'EMAIL_BOUNCED' | 'EMAIL_COMPLAINT_RECEIVED' | 'EMAIL_UNSUBSCRIBED';
  tenantId: string;
  correlationId: string;
  actor: WorkflowActor;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

function getFirstHeader(headers: Headers, key: string): string | null {
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() === key.toLowerCase()) return v;
  }
  return null;
}

function parseResendTags(value: unknown): Record<string, string> {
  if (!value) return {};

  if (Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const name = (entry as any).name;
      const tagValue = (entry as any).value;
      if (typeof name === 'string' && name.length > 0 && tagValue != null) {
        out[name] = String(tagValue);
      }
    }
    return out;
  }

  if (typeof value === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof k === 'string' && k.length > 0 && v != null) {
        out[k] = String(v);
      }
    }
    return out;
  }

  return {};
}

function decodeSvixSecret(webhookSecret: string): Buffer {
  const trimmed = webhookSecret.trim();
  if (trimmed.startsWith('whsec_')) {
    return Buffer.from(trimmed.slice('whsec_'.length), 'base64');
  }
  return Buffer.from(trimmed, 'utf8');
}

function isTimestampFresh(timestampSeconds: number, toleranceSeconds: number): boolean {
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestampSeconds) <= toleranceSeconds;
}

function findSvixV1Signatures(svixSignatureHeader: string): string[] {
  const parts = svixSignatureHeader.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  for (const part of parts) {
    // Typical: "v1,BASE64" but allow multiple comma-separated segments.
    for (const segment of part.split(';')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const [version, sig] = trimmed.split(',').map((v) => v?.trim());
      if (version === 'v1' && sig) candidates.push(sig);
    }
  }
  // Also handle the common format where the header is comma-separated pairs.
  if (candidates.length === 0) {
    const commaParts = svixSignatureHeader.split(',').map((v) => v.trim());
    for (let i = 0; i < commaParts.length - 1; i++) {
      if (commaParts[i] === 'v1') {
        candidates.push(commaParts[i + 1]);
        i++;
      }
    }
  }
  return candidates;
}

export function verifyResendWebhookSignature(params: {
  payload: string;
  headers: Headers;
  webhookSecret?: string;
  toleranceSeconds?: number;
}): { verified: boolean; reason?: string } {
  const webhookSecret = params.webhookSecret?.trim();
  if (!webhookSecret) {
    return { verified: true, reason: 'no_secret_configured' };
  }

  const svixId = getFirstHeader(params.headers, 'svix-id');
  const svixTimestamp = getFirstHeader(params.headers, 'svix-timestamp');
  const svixSignature = getFirstHeader(params.headers, 'svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { verified: false, reason: 'missing_svix_headers' };
  }

  const timestampSeconds = Number(svixTimestamp);
  const toleranceSeconds = params.toleranceSeconds ?? 5 * 60;
  if (!isTimestampFresh(timestampSeconds, toleranceSeconds)) {
    return { verified: false, reason: 'timestamp_out_of_range' };
  }

  const signedPayload = `${svixTimestamp}.${params.payload}`;
  const secretBytes = decodeSvixSecret(webhookSecret);
  const expected = crypto.createHmac('sha256', secretBytes).update(signedPayload).digest('base64');
  const candidates = findSvixV1Signatures(svixSignature);

  for (const candidate of candidates) {
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(candidate, 'base64'),
          Buffer.from(expected, 'base64')
        )
      ) {
        return { verified: true };
      }
    } catch {
      // Ignore malformed base64 candidate.
    }
  }

  return { verified: false, reason: 'signature_mismatch' };
}

export function mapResendWebhookToWorkflowEvents(params: {
  webhook: ResendWebhookEvent;
  svixId?: string | null;
}): ResendWorkflowEventToPublish[] {
  const type = params.webhook.type;
  const createdAt = params.webhook.created_at;
  const data = params.webhook.data || {};
  const svixId = params.svixId || 'unknown';

  if (!type) return [];

  const tags = parseResendTags((data as any).tags);
  const tenantId = tags.alga_tenant_id || 'system';
  const messageId = tags.alga_workflow_message_id || '';
  const correlationId = tags.alga_correlation_id || messageId || (data as any).email_id || svixId;
  const actor: WorkflowActor = { actorType: 'SYSTEM' };

  const providerMessageId = String((data as any).email_id || '');
  const toEmail = Array.isArray((data as any).to) ? String((data as any).to[0] || '') : String((data as any).to || '');

  const idempotencyBase = `resend_webhook:${svixId}:${type}`;

  switch (type) {
    case 'email.delivered': {
      if (!messageId || !providerMessageId || !toEmail) return [];
      return [
        {
          eventType: 'EMAIL_DELIVERED',
          tenantId,
          correlationId,
          actor,
          idempotencyKey: `${idempotencyBase}:delivered`,
          payload: buildEmailDeliveredPayload({
            messageId,
            providerMessageId,
            to: toEmail,
            deliveredAt: createdAt,
            provider: 'resend',
          }),
        },
      ];
    }
    case 'email.bounced':
    case 'email.soft_bounced': {
      if (!messageId || !providerMessageId || !toEmail) return [];
      const bounceType: 'hard' | 'soft' = type === 'email.soft_bounced' ? 'soft' : 'hard';
      return [
        {
          eventType: 'EMAIL_BOUNCED',
          tenantId,
          correlationId,
          actor,
          idempotencyKey: `${idempotencyBase}:bounced`,
          payload: buildEmailBouncedPayload({
            messageId,
            providerMessageId,
            to: toEmail,
            bouncedAt: createdAt,
            bounceType,
            smtpCode: (data as any).smtp_code ? String((data as any).smtp_code) : undefined,
            smtpMessage: (data as any).smtp_message ? String((data as any).smtp_message) : undefined,
          }),
        },
      ];
    }
    case 'email.complained': {
      if (!messageId || !providerMessageId || !toEmail) return [];
      return [
        {
          eventType: 'EMAIL_COMPLAINT_RECEIVED',
          tenantId,
          correlationId,
          actor,
          idempotencyKey: `${idempotencyBase}:complained`,
          payload: buildEmailComplaintReceivedPayload({
            messageId,
            providerMessageId,
            to: toEmail,
            complainedAt: createdAt,
            provider: 'resend',
            complaintType: (data as any).complaint_type ? String((data as any).complaint_type) : undefined,
          }),
        },
      ];
    }
    case 'contact.updated': {
      const isUnsubscribed = (data as any).unsubscribed === true;
      if (!isUnsubscribed) return [];
      const recipientEmail = String((data as any).email || '');
      if (!recipientEmail) return [];
      return [
        {
          eventType: 'EMAIL_UNSUBSCRIBED',
          tenantId,
          correlationId,
          actor,
          idempotencyKey: `${idempotencyBase}:unsubscribed`,
          payload: buildEmailUnsubscribedPayload({
            recipientEmail,
            unsubscribedAt: createdAt,
            source: 'resend',
            ...(messageId ? { messageId } : {}),
          }),
        },
      ];
    }
    default:
      return [];
  }
}

export function logResendWebhookMappingOutcome(params: {
  webhookType?: string;
  events: ResendWorkflowEventToPublish[];
}): void {
  if (!params.webhookType) return;
  if (params.events.length > 0) {
    logger.info('[ResendWebhook] mapped webhook event(s)', {
      type: params.webhookType,
      count: params.events.length,
      eventTypes: params.events.map((e) => e.eventType),
    });
  } else {
    logger.debug('[ResendWebhook] ignored webhook event', {
      type: params.webhookType,
    });
  }
}

