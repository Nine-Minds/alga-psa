import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import { enqueueUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueue';

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
  emailData?: {
    id?: string;
  };
}

async function assertTenantEmailProductAccess(knex: any, tenantId: string): Promise<void> {
  const tenant = await knex('tenants').where({ tenant: tenantId }).first('product_code');
  const productCode = typeof tenant?.product_code === 'string' ? tenant.product_code : 'psa';
  if (productCode !== 'psa' && productCode !== 'algadesk') {
    throw new Error(`Product access denied for tenant ${tenantId}`);
  }
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
    await assertTenantEmailProductAccess(knex, provider.tenant);

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

    const pointerUidRaw = payload.pointer?.uid;
    const pointerUid =
      typeof pointerUidRaw === 'number' && Number.isFinite(pointerUidRaw)
        ? String(Math.floor(pointerUidRaw))
        : asNonEmptyString(pointerUidRaw);
    if (!pointerUid) {
      return NextResponse.json({ error: 'pointer.uid is required' }, { status: 400 });
    }

    const mailbox = asNonEmptyString(payload.pointer?.mailbox) || 'INBOX';
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
  } catch (error: any) {
    console.error('IMAP webhook handler error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
