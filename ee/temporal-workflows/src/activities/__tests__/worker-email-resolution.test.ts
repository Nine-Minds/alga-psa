import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationService, getEmailNotificationService } from '@alga-psa/notifications/notifications/email';
import { TenantEmailOutboundAdapter } from '@alga-psa/email';

const mockTenantDb = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  tenantDb: mockTenantDb,
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn().mockResolvedValue('en'),
}));

describe('worker outbound email resolution', () => {
  it('resolves the real notification service and sends through the board-aware adapter', async () => {
    const service = getEmailNotificationService();
    expect(service).toBeInstanceOf(EmailNotificationService);
    expect(typeof service.sendNotification).toBe('function');

    const sendEmail = vi.fn().mockResolvedValue({ success: true, messageId: 'controlled-smtp-id' });
    const adapter = new TenantEmailOutboundAdapter(() => ({ sendEmail } as never));
    await expect(adapter.send({
      tenantId: 'worker-tenant',
      to: 'escalation@example.test',
      subject: 'SLA escalation',
      html: '<p>Ticket routed</p>',
      text: 'Ticket routed',
      mailClass: 'ticket',
      boardId: 'routed-board',
    })).resolves.toEqual({ status: 'sent', messageId: 'controlled-smtp-id' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      mailClass: 'ticket',
      boardId: 'routed-board',
    }));
  });

  it('renders a notification and sends it through an injected outbound port', async () => {
    const table = vi.fn((name: string) => {
      const query = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(name === 'notification_subtypes' ? { id: 77, category_id: 9 } : null),
        insert: vi.fn().mockResolvedValue([]),
      };
      return query;
    });
    mockTenantDb.mockImplementation(() => ({ table }));
    const outboundMail = { send: vi.fn().mockResolvedValue({ status: 'sent', messageId: 'rendered-message-id' }) };
    const service = new EmailNotificationService(outboundMail);
    vi.spyOn(service as never, 'getTenantKnex' as never).mockResolvedValue({} as never);
    vi.spyOn(service, 'getSettings').mockResolvedValue({ is_enabled: true } as never);
    vi.spyOn(service, 'getEffectiveTemplate').mockResolvedValue({
      subject: 'Escalated {{ticketNumber}}',
      html_content: '<p>{{ticketTitle}}</p>',
    } as never);

    await expect(service.sendNotification({
      tenant: 'worker-tenant',
      userId: 'manager-1',
      subtypeId: 77,
      emailAddress: 'manager@example.test',
      templateName: 'sla-escalation',
      data: { ticketNumber: 'T-77', ticketTitle: 'Worker resolution check' },
      mailClass: 'ticket',
      boardId: 'ticket-board-77',
    })).resolves.toEqual({ status: 'sent', messageId: 'rendered-message-id' });
    expect(outboundMail.send).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Escalated T-77',
      html: '<p>Worker resolution check</p>',
      mailClass: 'ticket',
      boardId: 'ticket-board-77',
    }));
  });
});
