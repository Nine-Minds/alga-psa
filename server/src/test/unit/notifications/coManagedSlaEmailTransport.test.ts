import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ send: vi.fn(), locale: vi.fn(), tenant: vi.fn(), connection: vi.fn(), template: vi.fn(), loadTemplate: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: runtime.connection }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: (tenant: string) => { runtime.tenant(tenant); return { sendEmail: runtime.send }; } },
  DatabaseTemplateProcessor: class { constructor(db: unknown, name: string) { runtime.template(db, name); } process(options: unknown) { return runtime.loadTemplate(options); } },
  StaticTemplateProcessor: class { constructor(private subject: string, private html: string, private text: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: runtime.locale }));
import { sendCoManagedSlaEmail } from '@alga-psa/jobs/handlers/coManagedSlaEmailTransport';
import type { CoManagedSlaEmailDelivery } from '@alga-psa/co-managed';
const delivery = (): CoManagedSlaEmailDelivery => ({ tenant: randomUUID(), recipientUserId: randomUUID(), email: 'current@example.test',
  recipientName: 'A < B', messageId: '<stable-sla@notifications.alga.invalid>', subtypeId: 42,
  message: { resource: { tenant: randomUUID(), relationshipId: randomUUID(), kind: 'ticket', id: randomUUID() }, eventId: randomUUID(), obligationId: randomUUID(),
    slaType: 'response', notificationType: 'breach', thresholdPercent: 100, dueAt: '2026-09-08T12:00:00.000Z', occurredAt: '2026-09-08T12:15:00.000Z',
    elapsedMilliseconds: 75 * 60000, targetMinutes: 60, ticketNumber: 'T-1', ticketTitle: '<img src=x onerror=alert(1)> & $&\r\nInjected' } });
beforeEach(() => {
  vi.clearAllMocks(); runtime.send.mockResolvedValue({ success: true }); runtime.locale.mockResolvedValue('fr'); runtime.connection.mockResolvedValue('db');
  runtime.loadTemplate.mockResolvedValue({ subject: '{{ticketTitle}}', html: '<p>{{recipientName}} {{ticketTitle}}</p><a href="{{ticketUrl}}">Open</a>', text: '{{ticketTitle}}\n{{ticketUrl}}' });
});
it('uses current tenant templates with safe substitution, qualified navigation and caller-owned retry', async () => {
  const item = delivery();
  expect(await sendCoManagedSlaEmail(item)).toEqual({ status: 'delivered' });
  expect(runtime.template).toHaveBeenCalledWith('db', 'sla-breach');
  expect(runtime.loadTemplate).toHaveBeenCalledWith({ tenantId: item.tenant, locale: 'fr' });
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(params).toMatchObject({ to: item.email, userId: item.recipientUserId, tenantId: item.tenant, notificationSubtypeId: 42,
    retryPolicy: 'caller', headers: { 'Message-ID': item.messageId } });
  expect(content.html).toContain('&lt;img'); expect(content.html).not.toContain('<img'); expect(content.html).toContain('A &lt; B');
  expect(content.html).toContain('$&amp;'); expect(content.text).toContain('$&'); expect(content.subject).not.toMatch(/[\r\n]/);
  expect(content.text).toContain(`/msp/co-management/tickets/${item.message.resource.tenant}/${item.message.resource.relationshipId}/${item.message.resource.id}`);
});
it.each([
  [{ success: false, metadata: { retryable: true, retryAfterMs: 90000 } }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed', retryAfterMs: 90000 }],
  [{ success: false, metadata: { retryable: false } }, { status: 'failed', retryable: false, errorCode: 'email_provider_failed', retryAfterMs: undefined }],
  [{ success: true, queued: true }, { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' }],
])('returns provider completion to the owning SLA queue (%j)', async (provider, result) => {
  runtime.send.mockResolvedValue(provider); expect(await sendCoManagedSlaEmail(delivery())).toEqual(result);
});
it('keeps template loading failures retryable through the caller without sending fallback text', async () => {
  runtime.loadTemplate.mockRejectedValue(new Error('Template unavailable'));
  await expect(sendCoManagedSlaEmail(delivery())).rejects.toThrow('Template unavailable');
  expect(runtime.send).not.toHaveBeenCalled();
});
