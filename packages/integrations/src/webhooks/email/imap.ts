import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import { publishEvent } from '@alga-psa/shared/events/publisher';
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

    const eventPayload = {
      tenantId: provider.tenant,
      tenant: provider.tenant,
      providerId: provider.id,
      emailData,
    };

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
  } catch (error: any) {
    console.error('IMAP webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
