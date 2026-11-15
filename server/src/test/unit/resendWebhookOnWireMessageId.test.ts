import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  publish: vi.fn(async () => undefined),
  getConnection: vi.fn(async (tenant: string) => ({ conn: tenant })),
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/email/reconcileOnWireMessageId', () => ({ reconcileOnWireMessageId: mocks.reconcile }));
vi.mock('@alga-psa/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishWorkflowEvent: mocks.publish }));

import { POST } from 'server/src/app/api/email/webhooks/resend/route';
import { extractResendOnWireMessageIdUpdate } from 'server/src/services/email/webhooks/resendWebhookEvents';

const RAW_SECRET = Buffer.from('super-secret').toString('base64');
const WIRE = '<0100019abc-def-000000@email.amazonses.com>';

function request(body: unknown, opts: { sign?: boolean } = {}) {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    opts.sign === false
      ? 'v1,ZmFrZXNpZw=='
      : `v1,${crypto.createHmac('sha256', Buffer.from(RAW_SECRET, 'base64')).update(`${timestamp}.${payload}`).digest('base64')}`;
  return new Request('http://localhost/api/email/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': 'msg_1', 'svix-timestamp': timestamp, 'svix-signature': signature },
    body: payload,
  }) as any;
}

const event = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  created_at: '2026-11-11T00:00:00.000Z',
  data: {
    email_id: 're_123',
    message_id: WIRE,
    to: ['one@example.com'],
    tags: [
      { name: 'alga_tenant_id', value: 'tenant-1' },
      { name: 'alga_workflow_message_id', value: 'wf-1' },
    ],
    ...data,
  },
});

describe('Resend webhook on-wire Message-ID (T004, F004)', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${RAW_SECRET}`);
    mocks.reconcile.mockReset().mockResolvedValue({ status: 'recorded', rowsMatched: 1, rowsRecorded: 1 });
    mocks.publish.mockClear();
    mocks.getConnection.mockClear();
  });

  it('reconciles on a signed email.sent using the signed tenant tag and email_id', async () => {
    const res = await POST(request(event('email.sent')));
    expect(res.status).toBe(200);
    expect(mocks.getConnection).toHaveBeenCalledWith('tenant-1');
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith(
      { conn: 'tenant-1' },
      { tenant: 'tenant-1', providerMessageId: 're_123', onWireMessageId: WIRE }
    );
    expect(mocks.publish).not.toHaveBeenCalled(); // email.sent publishes no workflow event
  });

  it('does nothing for an event without message_id', async () => {
    const res = await POST(request(event('email.sent', { message_id: undefined })));
    expect(res.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('does nothing for an unsigned event', async () => {
    const res = await POST(request(event('email.sent'), { sign: false }));
    expect(res.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('does nothing when no secret is configured (fails closed)', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
    const res = await POST(request(event('email.sent')));
    expect(res.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('does nothing without a tenant tag or for the system tenant', async () => {
    await POST(request(event('email.sent', { tags: [] })));
    await POST(request(event('email.sent', { tags: [{ name: 'alga_tenant_id', value: 'system' }] })));
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('reads message_id on other email.* events and still publishes delivered/bounced/complained', async () => {
    for (const [type, eventType] of [
      ['email.delivered', 'EMAIL_DELIVERED'],
      ['email.bounced', 'EMAIL_BOUNCED'],
      ['email.complained', 'EMAIL_COMPLAINT_RECEIVED'],
    ] as const) {
      mocks.publish.mockClear();
      mocks.reconcile.mockClear();
      const res = await POST(request(event(type)));
      expect(res.status).toBe(200);
      expect(mocks.reconcile).toHaveBeenCalledTimes(1);
      expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType }));
    }
  });

  it('keeps publishing unsubscribed (contact.updated) and does not reconcile it', async () => {
    const res = await POST(request({
      type: 'contact.updated',
      created_at: '2026-11-11T00:00:00.000Z',
      data: { unsubscribed: true, email: 'one@example.com', tags: [{ name: 'alga_tenant_id', value: 'tenant-1' }] },
    }));
    expect(res.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'EMAIL_UNSUBSCRIBED' }));
  });

  it('a reconciliation failure never fails the webhook or blocks publishing', async () => {
    mocks.reconcile.mockRejectedValue(new Error('db down'));
    const res = await POST(request(event('email.delivered')));
    expect(res.status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'EMAIL_DELIVERED' }));
  });

  it('extractResendOnWireMessageIdUpdate ignores non-email events', () => {
    expect(extractResendOnWireMessageIdUpdate({ type: 'contact.updated', data: { message_id: WIRE, email_id: 'x', tags: { alga_tenant_id: 't' } } })).toBeNull();
  });
});
