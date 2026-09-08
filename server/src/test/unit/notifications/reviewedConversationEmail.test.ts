import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ settings: null as any, provider: null as any, fallback: false, suspended: false,
  send: vi.fn(), event: vi.fn(), tables: [] as string[] }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/core/rateLimit', () => ({ TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: runtime.event }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => ({}), isTenantSuspended: async () => runtime.suspended,
  tenantDb: () => ({ table: (table: string) => {
    runtime.tables.push(table);
    if (table === 'tenant_email_settings') return { first: async () => runtime.settings };
    if (table === 'email_sending_logs') return { insert: async () => 1 };
    throw new Error(`Unexpected reviewed email table ${table}`);
  } }) }));
vi.mock('../../../../../packages/email/src/features', () => ({ isEnterprise: true }));
vi.mock('../../../../../packages/email/src/senderIdentity', async original => ({
  ...await original<any>(), resolveTenantCompanyName: async () => 'Service desk',
}));
vi.mock('../../../../../packages/email/src/providers/EmailProviderManager', () => ({ EmailProviderManager: class {
  async initialize() { if (runtime.fallback) throw new Error('Provider unavailable'); }
  async getAvailableProviders() { return [runtime.provider]; }
} }));
vi.mock('../../../../../packages/email/src/system/SystemEmailProviderFactory', () => ({ SystemEmailProviderFactory: {
  getConfigFingerprint: () => 'review-test-system', createProvider: async () => ({ providerId: 'system', providerType: 'resend', sendEmail: runtime.send }),
} }));
import { TenantEmailService } from '../../../../../packages/email/src/TenantEmailService';
const tenantId = 'review-test-tenant';
const input = () => ({ tenantId, from: { email: 'support@example.test', name: 'Service desk' }, replyTo: { email: 'intake@example.test' },
  to: [{ email: 'vendor@example.test' }], cc: [{ email: 'colleague@example.test' }], subject: 'Circuit diagnosis', html: '<p>Selected reply</p>', text: 'Selected reply',
  headers: { 'Message-ID': '<operation@conversation.example.test>', 'In-Reply-To': '<prior@conversation.example.test>', References: '<prior@conversation.example.test>' },
  attachments: [{ filename: 'selected.txt', contentType: 'text/plain', content: Buffer.from('Selected file') }], threading: 'conversation' as const, retryPolicy: 'caller' as const,
  entityType: 'ticket', entityId: 'ticket', replyContext: { ticketId: 'ticket', commentId: 'comment', threadId: 'root' } });
beforeEach(async () => {
  vi.clearAllMocks(); runtime.fallback = false; runtime.suspended = false; runtime.tables = [];
  runtime.settings = { tenant: tenantId, email_provider: 'smtp', provider_configs: [{ providerId: 'smtp', providerType: 'smtp', isEnabled: true, config: { from: 'support@example.test' } }], updated_at: new Date('2026-09-01T00:00:00Z') };
  runtime.provider = { providerId: 'smtp', providerType: 'smtp', sendEmail: runtime.send };
  runtime.send.mockReset().mockResolvedValue({ success: true, messageId: 'accepted', providerId: 'smtp', providerType: 'smtp', sentAt: new Date() });
  runtime.event.mockResolvedValue(undefined);
  await TenantEmailService.invalidateTenantSettings(tenantId);
});
afterEach(async () => { vi.unstubAllEnvs(); await TenantEmailService.invalidateTenantSettings(tenantId); });

it('reviews without delivery and sends exactly the selected envelope, files and conversation headers', async () => {
  const service = TenantEmailService.getInstance(tenantId), params = input();
  const review = await service.prepareReviewedEmail(params);
  expect(review).toMatchObject({ from: params.from, replyTo: params.replyTo, to: params.to, cc: params.cc, text: params.text,
    files: [{ filename: 'selected.txt', size: 13 }] });
  expect(runtime.send).not.toHaveBeenCalled(); expect(runtime.event).not.toHaveBeenCalled();
  const sending = service.sendEmail({ ...params, reviewed: review });
  params.attachments[0].content.fill(0); params.to[0].email = 'late-mutation@example.test';
  expect(await sending).toMatchObject({ success: true, metadata: { deliveryStatus: 'delivered' } });
  expect(runtime.send).toHaveBeenCalledOnce();
  expect(runtime.send.mock.calls[0][0]).toMatchObject({ from: review.from, to: review.to, cc: params.cc, replyTo: review.replyTo,
    headers: params.headers, html: params.html, text: params.text, attachments: [{ ...params.attachments[0], content: Buffer.from('Selected file') }] });
  expect(runtime.tables).not.toContain('tickets'); expect(runtime.tables).not.toContain('comments');
});

it('rejects changed bodies, recipients, attachment bytes and settings before transport or workflow fanout', async () => {
  const service = TenantEmailService.getInstance(tenantId), params = input(), review = await service.prepareReviewedEmail(params);
  for (const change of [{ text: 'Unreviewed text' }, { to: [{ email: 'someone-else@example.test' }] },
    { attachments: [{ ...params.attachments[0], content: Buffer.from('Different file') }] }, { headers: { ...params.headers, References: '<requester@ticket.example.test>' } }]) {
    expect(await service.sendEmail({ ...params, ...change, reviewed: review })).toMatchObject({ success: false, metadata: { errorCode: 'review_changed', deliveryStatus: 'not_attempted' } });
  }
  runtime.settings.updated_at = new Date('2026-09-02T00:00:00Z');
  expect(await service.sendEmail({ ...params, reviewed: review })).toMatchObject({ success: false, metadata: { errorCode: 'sender_changed', deliveryStatus: 'not_attempted' } });
  expect(runtime.send).not.toHaveBeenCalled(); expect(runtime.event).not.toHaveBeenCalled();
});

it('shows a fixed Microsoft mailbox and an explicit fallback sender before human review', async () => {
  const service = TenantEmailService.getInstance(tenantId), params = input();
  runtime.provider = { ...runtime.provider, providerType: 'microsoft', resolveFromAddress: (from: any) => ({ ...from, email: 'actual-mailbox@example.test' }) };
  const original = await service.prepareReviewedEmail(params);
  expect(original.from.email).toBe('actual-mailbox@example.test');
  runtime.fallback = true; runtime.settings.updated_at = new Date('2026-09-02T00:00:00Z');
  vi.stubEnv('EMAIL_FROM', 'platform@system.example.test');
  expect(await service.sendEmail({ ...params, reviewed: original })).toMatchObject({ success: false, metadata: { errorCode: 'sender_changed' } });
  const fallback = await service.prepareReviewedEmail(params);
  expect(fallback).toMatchObject({ providerId: 'system', from: { email: 'platform@system.example.test' }, replyTo: params.replyTo });
  expect(await service.sendEmail({ ...params, reviewed: fallback })).toMatchObject({ success: true });
  expect(runtime.send.mock.calls[0][0]).toMatchObject({ from: fallback.from, replyTo: params.replyTo });
});

it('distinguishes uncertain provider outcomes from unsent reviews and forbids the generic retry queue', async () => {
  const service = TenantEmailService.getInstance(tenantId), params = input(), review = await service.prepareReviewedEmail(params);
  expect(await service.sendEmail({ ...params, retryPolicy: 'queue', reviewed: review })).toMatchObject({ success: false, metadata: { deliveryStatus: 'not_attempted' } });
  runtime.send.mockRejectedValueOnce(new Error('SMTP connection lost after DATA'));
  expect(await service.sendEmail({ ...params, reviewed: review })).toMatchObject({ success: false, metadata: { deliveryStatus: 'unknown', retryable: false } });
  expect(runtime.send).toHaveBeenCalledOnce();
  runtime.suspended = true;
  expect(await service.sendEmail({ ...params, reviewed: review })).toMatchObject({ success: false, metadata: { deliveryStatus: 'not_attempted' } });
  expect(runtime.send).toHaveBeenCalledOnce();
});
