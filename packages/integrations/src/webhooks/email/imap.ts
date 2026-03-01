import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import type {
  EmailIngressSkipReason,
  EmailMessageDetails,
} from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';
import {
  isImapInboundEmailInAppAsyncModeEnabled,
  isImapInboundEmailInAppEventBusFallbackEnabled,
  isImapInboundEmailInAppProcessingEnabled,
  isUnifiedInboundEmailPointerQueueEnabled,
} from '@alga-psa/shared/services/email/inboundEmailInAppFeatureFlag';
import { enqueueUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueue';
import { enqueueImapInAppJob } from './imapInAppQueue';

interface ImapWebhookPointerPayload {
  mailbox?: string;
  uid?: string | number;
  uidValidity?: string;
  messageId?: string;
}

interface ImapWebhookPayload {
  providerId?: string;
  tenant?: string;
  tenantId?: string;
  pointer?: ImapWebhookPointerPayload;
  emailData?: Partial<EmailMessageDetails>;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_ATTACHMENT_COUNT = 25;
const DEFAULT_MAX_RAW_MIME_BYTES = 25 * 1024 * 1024;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parsePositiveEnvNumber(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function estimateBase64DecodedSize(base64: string): number {
  const value = base64.replace(/\s+/g, '');
  if (!value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function normalizeExistingIngressSkipReasons(
  value: unknown
): EmailIngressSkipReason[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EmailIngressSkipReason => {
    if (!item || typeof item !== 'object') return false;
    const reason = (item as any).reason;
    const type = (item as any).type;
    return (
      (type === 'attachment' || type === 'raw_mime') &&
      (reason === 'attachment_over_max_bytes' ||
        reason === 'attachment_count_exceeded' ||
        reason === 'attachment_total_bytes_exceeded' ||
        reason === 'raw_mime_over_max_bytes')
    );
  });
}

function normalizeEmailDataWithIngressCaps(input: {
  emailData: Partial<EmailMessageDetails>;
  providerId: string;
  tenant: string;
}): { emailData: EmailMessageDetails } | { error: string } {
  const source = input.emailData;
  const messageId = asNonEmptyString(source.id);
  if (!messageId) {
    return { error: 'emailData.id is required' };
  }

  const fromEmail = asNonEmptyString(source.from?.email);
  if (!fromEmail) {
    return { error: 'emailData.from.email is required' };
  }

  const subject = typeof source.subject === 'string' ? source.subject : '';
  const bodyText = typeof source.body?.text === 'string' ? source.body.text : '';
  const bodyHtml = typeof source.body?.html === 'string' ? source.body.html : undefined;

  const maxAttachmentBytes = parsePositiveEnvNumber(
    'IMAP_MAX_ATTACHMENT_BYTES',
    DEFAULT_MAX_ATTACHMENT_BYTES
  );
  const maxTotalAttachmentBytes = Math.max(
    maxAttachmentBytes,
    parsePositiveEnvNumber('IMAP_MAX_TOTAL_ATTACHMENT_BYTES', DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES)
  );
  const maxAttachmentCount = parsePositiveEnvNumber(
    'IMAP_MAX_ATTACHMENT_COUNT',
    DEFAULT_MAX_ATTACHMENT_COUNT
  );
  const maxRawMimeBytes = parsePositiveEnvNumber('IMAP_MAX_RAW_MIME_BYTES', DEFAULT_MAX_RAW_MIME_BYTES);

  const ingressSkipReasons: EmailIngressSkipReason[] = normalizeExistingIngressSkipReasons(
    source.ingressSkipReasons
  );

  const rawAttachments = Array.isArray(source.attachments) ? source.attachments : [];
  let includedAttachmentBytes = 0;
  const normalizedAttachments: NonNullable<EmailMessageDetails['attachments']> = [];

  for (let index = 0; index < rawAttachments.length; index += 1) {
    const att = rawAttachments[index];
    if (!att || typeof att !== 'object') {
      return { error: `attachments[${index}] must be an object` };
    }

    const id = asNonEmptyString(att.id);
    const name = asNonEmptyString(att.name);
    const contentType = asNonEmptyString(att.contentType);
    const size =
      typeof att.size === 'number' && Number.isFinite(att.size) && att.size > 0
        ? Math.floor(att.size)
        : null;

    if (!id || !name || !contentType || size === null) {
      return {
        error:
          'attachments[] entries must include id, name, contentType, and positive numeric size',
      };
    }

    const contentId = asNonEmptyString(att.contentId) ?? undefined;
    const isInline = typeof att.isInline === 'boolean' ? att.isInline : undefined;
    const content = att.content;
    const normalizedContent =
      typeof content === 'string' && content.trim().length > 0 ? content.trim() : undefined;

    if (content !== undefined && typeof content !== 'string') {
      return { error: `attachments[${index}].content must be a base64 string when provided` };
    }
    if (normalizedContent && !isLikelyBase64(normalizedContent)) {
      return { error: `attachments[${index}].content must be valid base64` };
    }

    if (normalizedAttachments.length >= maxAttachmentCount) {
      ingressSkipReasons.push({
        type: 'attachment',
        reason: 'attachment_count_exceeded',
        attachmentId: id,
        attachmentName: name,
        size,
        cap: maxAttachmentCount,
      });
      continue;
    }

    if (size > maxAttachmentBytes) {
      ingressSkipReasons.push({
        type: 'attachment',
        reason: 'attachment_over_max_bytes',
        attachmentId: id,
        attachmentName: name,
        size,
        cap: maxAttachmentBytes,
      });
      continue;
    }

    if (includedAttachmentBytes + size > maxTotalAttachmentBytes) {
      ingressSkipReasons.push({
        type: 'attachment',
        reason: 'attachment_total_bytes_exceeded',
        attachmentId: id,
        attachmentName: name,
        size,
        cap: maxTotalAttachmentBytes,
      });
      continue;
    }

    includedAttachmentBytes += size;
    normalizedAttachments.push({
      id,
      name,
      contentType,
      size,
      contentId,
      isInline,
      content: normalizedContent,
    });
  }

  const rawMimeCandidate =
    asNonEmptyString(source.rawMimeBase64) ||
    asNonEmptyString(source.sourceMimeBase64) ||
    asNonEmptyString(source.rawSourceBase64);

  let rawMimeBase64 = asNonEmptyString(source.rawMimeBase64) ?? undefined;
  let sourceMimeBase64 = asNonEmptyString(source.sourceMimeBase64) ?? undefined;
  let rawSourceBase64 = asNonEmptyString(source.rawSourceBase64) ?? undefined;

  if (rawMimeCandidate) {
    if (!isLikelyBase64(rawMimeCandidate)) {
      return { error: 'raw MIME payload must be base64 when provided' };
    }
    const rawMimeBytes = estimateBase64DecodedSize(rawMimeCandidate);
    if (rawMimeBytes > maxRawMimeBytes) {
      ingressSkipReasons.push({
        type: 'raw_mime',
        reason: 'raw_mime_over_max_bytes',
        size: rawMimeBytes,
        cap: maxRawMimeBytes,
      });
      rawMimeBase64 = undefined;
      sourceMimeBase64 = undefined;
      rawSourceBase64 = undefined;
    }
  }

  return {
    emailData: {
      id: messageId,
      provider: 'imap',
      providerId: input.providerId,
      tenant: input.tenant,
      receivedAt: asNonEmptyString(source.receivedAt) || new Date().toISOString(),
      from: {
        email: fromEmail,
        name: asNonEmptyString(source.from?.name) ?? undefined,
      },
      to: Array.isArray(source.to)
        ? source.to
            .map((item) => ({
              email: asNonEmptyString(item?.email) || '',
              name: asNonEmptyString(item?.name) ?? undefined,
            }))
            .filter((item) => item.email.length > 0)
        : [],
      cc: Array.isArray(source.cc)
        ? source.cc
            .map((item) => ({
              email: asNonEmptyString(item?.email) || '',
              name: asNonEmptyString(item?.name) ?? undefined,
            }))
            .filter((item) => item.email.length > 0)
        : undefined,
      subject,
      body: {
        text: bodyText,
        html: bodyHtml,
      },
      attachments: normalizedAttachments,
      threadId: asNonEmptyString(source.threadId) ?? undefined,
      inReplyTo: asNonEmptyString(source.inReplyTo) ?? undefined,
      references: Array.isArray(source.references)
        ? source.references
            .map((value) => asNonEmptyString(value))
            .filter((value): value is string => Boolean(value))
        : undefined,
      rawMimeBase64,
      sourceMimeBase64,
      rawSourceBase64,
      ingressSkipReasons: ingressSkipReasons.length > 0 ? ingressSkipReasons : undefined,
    },
  };
}

function buildEventPayload(args: {
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}) {
  return {
    tenantId: args.tenantId,
    tenant: args.tenantId,
    providerId: args.providerId,
    emailData: args.emailData,
  };
}

export async function POST(request: NextRequest) {
  try {
    const expectedSecret = asNonEmptyString(process.env.IMAP_WEBHOOK_SECRET);
    if (!expectedSecret) {
      console.error('IMAP webhook rejected: IMAP_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }
    const providedSecret = asNonEmptyString(request.headers.get('x-imap-webhook-secret'));
    if (!providedSecret || !safeEquals(providedSecret, expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: ImapWebhookPayload;
    try {
      payload = (await request.json()) as ImapWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const providerId = asNonEmptyString(payload.providerId);
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }

    const knex = await getAdminConnection();
    const provider = await knex('email_providers')
      .where({ id: providerId, provider_type: 'imap' })
      .first('id', 'tenant', 'is_active', 'mailbox');

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    const tenantHint = asNonEmptyString(payload.tenantId) || asNonEmptyString(payload.tenant);
    if (tenantHint && tenantHint !== provider.tenant) {
      return NextResponse.json(
        { error: `Tenant mismatch for provider ${provider.id}` },
        { status: 400 }
      );
    }

    if (!provider.is_active) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Provider is inactive',
      });
    }

    const useUnifiedQueue = isUnifiedInboundEmailPointerQueueEnabled({
      tenantId: provider.tenant,
      providerId: provider.id,
    });

    if (useUnifiedQueue) {
      const pointerUidRaw = payload.pointer?.uid;
      const pointerUid =
        typeof pointerUidRaw === 'number' && Number.isFinite(pointerUidRaw)
          ? String(Math.floor(pointerUidRaw))
          : asNonEmptyString(pointerUidRaw);
      if (!pointerUid) {
        return NextResponse.json({ error: 'pointer.uid is required in unified queue mode' }, { status: 400 });
      }

      const mailbox = asNonEmptyString(payload.pointer?.mailbox) || provider.mailbox;
      const messageId =
        asNonEmptyString(payload.pointer?.messageId) || asNonEmptyString(payload.emailData?.id) || undefined;
      const uidValidity = asNonEmptyString(payload.pointer?.uidValidity) || undefined;

      try {
        const queued = await enqueueUnifiedInboundEmailQueueJob({
          tenantId: provider.tenant,
          providerId: provider.id,
          provider: 'imap',
          pointer: {
            mailbox,
            uid: pointerUid,
            uidValidity,
            messageId,
          },
        });

        return NextResponse.json({
          success: true,
          queued: true,
          handoff: 'unified_pointer_queue',
          providerId: provider.id,
          tenant: provider.tenant,
          messageId: messageId || null,
          uid: pointerUid,
          jobId: queued.job.jobId,
          queueDepth: queued.queueDepth,
        });
      } catch (enqueueError: any) {
        console.error('IMAP unified pointer enqueue failed', {
          providerId: provider.id,
          tenantId: provider.tenant,
          mailbox,
          uid: pointerUid,
          messageId: messageId || null,
          error: enqueueError?.message || String(enqueueError),
        });
        return NextResponse.json(
          { error: 'Failed to enqueue IMAP pointer job' },
          { status: 503 }
        );
      }
    }

    if (!payload.emailData || typeof payload.emailData !== 'object') {
      return NextResponse.json({ error: 'emailData object is required' }, { status: 400 });
    }

    const normalized = normalizeEmailDataWithIngressCaps({
      emailData: payload.emailData,
      providerId: provider.id,
      tenant: provider.tenant,
    });
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const emailData = normalized.emailData;
    const eventPayload = buildEventPayload({
      tenantId: provider.tenant,
      providerId: provider.id,
      emailData,
    });

    const useInApp = isImapInboundEmailInAppProcessingEnabled({
      tenantId: provider.tenant,
      providerId: provider.id,
    });

    if (!useInApp) {
      await publishEvent({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        tenant: provider.tenant,
        payload: eventPayload,
      });

      return NextResponse.json({
        success: true,
        queued: true,
        handoff: 'event_bus',
        providerId: provider.id,
        tenant: provider.tenant,
        messageId: emailData.id,
      });
    }

    if (
      isImapInboundEmailInAppAsyncModeEnabled({
        tenantId: provider.tenant,
        providerId: provider.id,
      })
    ) {
      const queued = enqueueImapInAppJob({
        tenantId: provider.tenant,
        providerId: provider.id,
        emailData,
      });

      return NextResponse.json({
        success: true,
        queued: true,
        handoff: 'in_app_async',
        providerId: provider.id,
        tenant: provider.tenant,
        messageId: emailData.id,
        jobId: queued.jobId,
        queueDepth: queued.queueDepth,
        activeWorkers: queued.activeWorkers,
      });
    }

    try {
      const result = await processInboundEmailInApp({
        tenantId: provider.tenant,
        providerId: provider.id,
        emailData,
      });

      return NextResponse.json({
        success: true,
        queued: false,
        handoff: 'in_app',
        providerId: provider.id,
        tenant: provider.tenant,
        messageId: emailData.id,
        result,
      });
    } catch (error: any) {
      if (isImapInboundEmailInAppEventBusFallbackEnabled()) {
        await publishEvent({
          eventType: 'INBOUND_EMAIL_RECEIVED',
          tenant: provider.tenant,
          payload: eventPayload,
        });

        return NextResponse.json({
          success: true,
          queued: true,
          handoff: 'event_bus_fallback',
          providerId: provider.id,
          tenant: provider.tenant,
          messageId: emailData.id,
          reason: error?.message || 'in_app_processing_failed',
        });
      }

      throw error;
    }
  } catch (error: any) {
    console.error('IMAP webhook handler error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
