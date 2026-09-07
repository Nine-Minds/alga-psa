import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ send: vi.fn(), locale: vi.fn(), tenant: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getInstance: (tenant: string) => { runtime.tenant(tenant); return { sendEmail: runtime.send }; } },
  StaticTemplateProcessor: class { constructor(private subject: string, private html: string, private text: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: runtime.locale }));
import { sendCoManagedCommentEmail } from '@alga-psa/jobs/handlers/coManagedCommentEmailTransport';
import type { CoManagedEmailDelivery } from '@alga-psa/co-managed';
const delivery = (): CoManagedEmailDelivery => ({ tenant: randomUUID(), recipientUserId: randomUUID(), email: 'authorized@example.test', messageId: '<stable@notifications.alga.invalid>', subtypeId: 3,
  message: { resource: { tenant: randomUUID(), relationshipId: randomUUID(), kind: 'ticket', id: randomUUID() }, commentId: randomUUID(), threadId: randomUUID(), audience: 'shared_it',
    ticketNumber: 'T-1', ticketTitle: '<img src=x onerror=alert(1)>', note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: '<script>private()</script> & current text', styles: {} }], children: [] }]),
    author: { tenant: randomUUID(), id: randomUUID(), kind: 'user', referenceId: null, displayName: 'A < B', organizationName: 'Customer' } } });
beforeEach(() => { runtime.send.mockReset().mockResolvedValue({ success: true }); runtime.locale.mockReset().mockResolvedValue('en'); runtime.tenant.mockClear(); });
it('renders only supplied authorized fields, escapes content, links the qualified source and retains caller-owned retry and stable identity', async () => {
  const item = delivery(); expect(await sendCoManagedCommentEmail(item)).toEqual({ status: 'delivered' });
  expect(runtime.tenant).toHaveBeenCalledWith(item.tenant);
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(params).toMatchObject({ tenantId: item.tenant, to: item.email, userId: item.recipientUserId, retryPolicy: 'caller', headers: { 'Message-ID': item.messageId } });
  expect(params).not.toHaveProperty('replyContext'); expect(params).not.toHaveProperty('entityId');
  expect(content.html).toContain(`/${item.message.resource.tenant}/${item.message.resource.relationshipId}/${item.message.resource.id}`);
  expect(content.html).toContain('&lt;script&gt;'); expect(content.html).not.toContain('<script>'); expect(content.html).not.toContain('<img src=x');
  expect(content.text).toContain('<script>private()</script> & current text'); expect(content.html).toContain('A &lt; B');
});
it.each(['en', 'en-AU', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'])('supports the recipient locale %s without changing resource identity', async locale => {
  runtime.locale.mockResolvedValue(locale); const item = delivery(); await sendCoManagedCommentEmail(item);
  const content = await runtime.send.mock.calls[0][0].templateProcessor.process();
  expect(content.subject).toBeTruthy(); expect(content.text).toContain(item.message.resource.id);
});
it.each([
  [{ success: false, metadata: { retryable: true, retryAfterMs: 70000 } }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed', retryAfterMs: 70000 }],
  [{ success: false, metadata: { retryable: false } }, { status: 'failed', retryable: false, errorCode: 'email_provider_failed' }],
  [{ success: true, queued: true }, { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' }],
  [{ success: false, error: 'Email service is disabled or not configured' }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed' }],
])('does not treat unavailable or deferred transport as completed delivery', async (result, expected) => {
  runtime.send.mockResolvedValue(result); expect(await sendCoManagedCommentEmail(delivery())).toMatchObject(expected);
});
