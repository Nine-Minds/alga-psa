import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import { withTransaction } from '@alga-psa/db';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

interface ImapWebhookPayload {
  providerId?: string;
  tenant?: string;
  tenantId?: string;
  emailData?: Partial<EmailMessageDetails>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function buildEmailData(payload: ImapWebhookPayload, providerId: string, tenant: string): EmailMessageDetails | null {
  if (!payload.emailData || typeof payload.emailData !== 'object') return null;
  const messageId = asNonEmptyString(payload.emailData.id);
  if (!messageId) return null;

  return {
    ...(payload.emailData as EmailMessageDetails),
    id: messageId,
    provider: 'imap',
    providerId,
    tenant,
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

    const emailData = buildEmailData(payload, provider.id, provider.tenant);
    if (!emailData) {
      return NextResponse.json({ error: 'emailData.id is required' }, { status: 400 });
    }

    const dedupeWhere = {
      message_id: emailData.id,
      provider_id: provider.id,
      tenant: provider.tenant,
    };

    let resultSummary: Record<string, unknown> = {};

    await withTransaction(knex, async (trx) => {
      const tableExists = await trx.schema.hasTable('email_processed_messages');
      let canUseProcessedMessages = false;
      if (tableExists) {
        // In mixed-schema environments, this table may still reference the legacy
        // email_provider_configs table. Only use it when the provider exists there.
        const legacyProviderTableExists = await trx.schema.hasTable('email_provider_configs');
        if (legacyProviderTableExists) {
          const legacyProvider = await trx('email_provider_configs')
            .where({ id: provider.id, tenant: provider.tenant })
            .first('id');
          canUseProcessedMessages = Boolean(legacyProvider);
        }
      }

      if (canUseProcessedMessages) {
        const existing = await trx('email_processed_messages').where(dedupeWhere).first();
        if (existing) {
          resultSummary = {
            duplicate: true,
            outcome: existing.processing_status || 'duplicate',
            ticketId: existing.ticket_id || null,
          };
          return;
        }

        await trx('email_processed_messages').insert({
          message_id: emailData.id,
          provider_id: provider.id,
          tenant: provider.tenant,
          processed_at: new Date(),
          processing_status: 'processing',
          from_email: emailData.from?.email || null,
          subject: emailData.subject || null,
          received_at: toDateOrNull(emailData.receivedAt),
          attachment_count: emailData.attachments?.length || 0,
          metadata: JSON.stringify({
            source: 'imap-webhook',
            webhookReceivedAt: new Date().toISOString(),
          }),
        });
      }

      let processingStatus = 'success';
      let errorMessage: string | null = null;
      let ticketId: string | null = null;

      const inAppResult = await processInboundEmailInApp({
        tenantId: provider.tenant,
        providerId: provider.id,
        emailData,
      });

      if (inAppResult?.outcome === 'skipped') {
        processingStatus = 'partial';
        errorMessage = `skipped:${inAppResult?.reason || 'unknown'}`;
      } else if (inAppResult?.outcome === 'deduped') {
        processingStatus = 'duplicate';
      }

      if (
        inAppResult &&
        typeof inAppResult === 'object' &&
        'ticketId' in inAppResult &&
        typeof inAppResult.ticketId === 'string'
      ) {
        ticketId = inAppResult.ticketId;
      }
      resultSummary = {
        duplicate: false,
        outcome: inAppResult?.outcome || 'processed',
        ticketId,
      };

      await trx('email_providers')
        .where({ id: provider.id, tenant: provider.tenant })
        .update({
          last_sync_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

      if (canUseProcessedMessages) {
        await trx('email_processed_messages')
          .where(dedupeWhere)
          .update({
            processing_status: processingStatus,
            ticket_id: ticketId,
            from_email: emailData.from?.email || null,
            subject: emailData.subject || null,
            received_at: toDateOrNull(emailData.receivedAt),
            attachment_count: emailData.attachments?.length || 0,
            error_message: errorMessage,
          });
      }
    });

    return NextResponse.json({
      success: true,
      providerId: provider.id,
      tenant: provider.tenant,
      messageId: emailData.id,
      ...resultSummary,
    });
  } catch (error: any) {
    console.error('IMAP webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
