import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/utils/workDate', () => ({
  resolveEffectiveTimeZone: vi.fn(async () => 'UTC'),
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getTenantDefaultLocale: vi.fn(async () => 'en'),
}));
vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({
  resolveTenantDefaultCountry: vi.fn(async () => ({ code: 'US', name: 'United States' })),
}));
vi.mock('@alga-psa/tenancy/server', () => ({
  resolveTenantAppBase: vi.fn(async () => ({ source: 'canonical', baseUrl: 'https://example.test' })),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  getConnection: vi.fn(async () => ({})),
}));

import { ticketEmailSubscriberTestHarness } from '../../../lib/eventBus/subscribers/ticketEmailSubscriber';
import { StaticTemplateProcessor } from '../../../../../packages/email/src/templateProcessors';

const require = createRequire(import.meta.url);
interface TemplateTranslation {
  language: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}
const { getTemplate } = require('../../../../migrations/utils/templates/email/tickets/ticketCreatedClient.cjs') as {
  getTemplate: () => { translations: TemplateTranslation[] };
};

const description = 'The branch printer cannot connect to the network.';
const ticket = {
  ticket_id: '00000000-0000-0000-0000-000000000253',
  ticket_number: 'T-253',
  title: 'Printer connection issue',
  client_name: 'Example Client',
  priority_name: 'High',
  status_name: 'New',
  assigned_to_name: 'Alex Agent',
  attributes: { description },
};

describe.each(getTemplate().translations)('ticket-created-client ($language)', (translation) => {
  it.each([
    { label: 'an inbound message ID', email_metadata: { messageId: '<original@example.test>' }, fromEmail: true },
    { label: 'no email metadata', email_metadata: undefined, fromEmail: false },
    { label: 'null email metadata', email_metadata: null, fromEmail: false },
    { label: 'metadata without a message ID', email_metadata: { provider: 'smtp' }, fromEmail: false },
    { label: 'an empty message ID', email_metadata: { messageId: '' }, fromEmail: false },
  ])('renders the confirmation with $label', async ({ email_metadata, fromEmail }) => {
    const { baseTicketContext, portalUrl } = await ticketEmailSubscriberTestHarness.buildTicketSummaryEmailContext(
      {} as Knex,
      '00000000-0000-0000-0000-000000000001',
      { ...ticket, email_metadata },
      undefined,
    );
    expect(baseTicketContext.fromEmail).toBe(fromEmail);

    const processor = new StaticTemplateProcessor(
      translation.subject,
      translation.htmlContent,
      translation.textContent,
    );
    const { subject, html, text } = await processor.process({
      templateData: { ticket: { ...baseTicketContext, url: portalUrl } },
    });

    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      // The description is the only bordered information box after the summary table.
      const descriptionBox = document.querySelector('table + div');
      if (fromEmail) {
        expect(descriptionBox).toBeNull();
        expect(document.body.textContent).not.toContain(description);
        expect(text).not.toContain(description);
        const nonEmailText = await processor.process({
          templateData: { ticket: { ...baseTicketContext, fromEmail: false, url: portalUrl } },
        });
        const descriptionLabel = nonEmailText.text.split(description)[0].trim().split('\n').at(-1)!;
        expect(text).not.toContain(descriptionLabel);
      } else {
        expect(descriptionBox?.textContent).toContain(description);
        expect(descriptionBox?.children).toHaveLength(2);
        expect(text).toContain(description);
      }
      expect(subject).toContain(ticket.title);
      expect(document.body.textContent).toContain(ticket.ticket_number);
      expect(document.body.textContent).toContain(ticket.priority_name);
      expect(document.body.textContent).toContain(ticket.status_name);
      expect(document.body.textContent).toContain(ticket.assigned_to_name);
      expect(document.querySelector(`a[href="${portalUrl}"]`)).not.toBeNull();
      expect(text).toContain(portalUrl);
    } finally {
      dom.window.close();
    }
  });
});
