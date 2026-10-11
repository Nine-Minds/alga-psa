import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ send: vi.fn(), template: vi.fn(), processor: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => 'db' }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getInstance: () => ({ sendEmail: runtime.send }) },
  StaticTemplateProcessor: class { constructor(...args: unknown[]) { runtime.processor(...args); } } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: async () => 'fr' }));
vi.mock('@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore', () => ({ getNotificationTemplate: runtime.template,
  renderTemplate: (value: string, data: any) => value.replace(/\{\{(\w+)\}\}/g, (_match, key) => data[key] ?? '') }));
import { sendCoManagedRoutingEmail } from '@alga-psa/jobs/handlers/coManagedRoutingEmailTransport';
const delivery = () => ({ tenant: 'msp', recipientUserId: 'tech', email: 'tech@example.test', recipientName: 'Tech', subtypeId: 12,
  messageId: '<stable-routing@example.test>', message: { resource: { tenant: 'customer', relationshipId: 'trust', kind: 'ticket' as const, id: 'ticket' },
    eventId: 'event', transition: 'escalated' as const, ownerLocal: false, ticketNumber: '42', ticketTitle: '<img src=x onerror=alert(1)> & "secret"' } });
beforeEach(() => { vi.clearAllMocks(); runtime.send.mockResolvedValue({ success: true });
  runtime.template.mockResolvedValue({ title: 'Ticket {{ticketNumber}}\r\nroute', message: 'Escalated: {{ticketTitle}}' }); });
it('routing email escapes current authorized text, uses qualified links and retains caller-owned retry identity', async () => {
  expect(await sendCoManagedRoutingEmail(delivery())).toEqual({ status: 'delivered' });
  expect(runtime.template).toHaveBeenCalledWith('db', 'msp', 'co-managed-ticket-escalated', 'fr');
  const [subject, html, text] = runtime.processor.mock.calls[0];
  expect(subject).toBe('Ticket 42 route'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  expect(text).toContain('<img'); expect(html).toContain('/msp/co-management/tickets/customer/trust/ticket');
  expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'msp', userId: 'tech', notificationSubtypeId: 12, retryPolicy: 'caller',
    headers: expect.objectContaining({ 'Message-ID': '<stable-routing@example.test>' }) }));
});
it('routing email rejects generic queue takeover so stale cached content is never retried outside recipient authority', async () => {
  runtime.send.mockResolvedValue({ success: true, queued: true });
  expect(await sendCoManagedRoutingEmail(delivery())).toEqual({ status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' });
});
it('routing email preserves provider retryability', async () => {
  runtime.send.mockResolvedValue({ success: false, metadata: { retryable: true, retryAfterMs: 60000 } });
  expect(await sendCoManagedRoutingEmail(delivery())).toEqual({ status: 'failed', retryable: true, errorCode: 'email_provider_failed', retryAfterMs: 60000 });
});
