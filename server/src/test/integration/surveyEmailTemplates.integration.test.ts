import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { DatabaseTemplateProcessor } from '../../lib/email/tenant/templateProcessors';

const TEMPLATE_NAME = 'SURVEY_TICKET_CLOSED';
const SUPPORTED_LOCALES = [
  { code: 'en', subject: "We'd love your feedback on ticket {{ticket_number}}" },
  { code: 'fr', subject: 'Votre avis sur le ticket {{ticket_number}} nous intéresse' },
  { code: 'es', subject: 'Queremos conocer tu opinión sobre el ticket {{ticket_number}}' },
  { code: 'de', subject: 'Wir freuen uns über Ihr Feedback zu Ticket {{ticket_number}}' },
  { code: 'nl', subject: 'We horen graag uw feedback over ticket {{ticket_number}}' },
  { code: 'it', subject: 'Ci farebbe piacere il tuo feedback sul ticket {{ticket_number}}' },
];

describe('Survey email templates', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 120000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('registers system templates for each supported locale', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const template = await db('system_email_templates')
        .where({ name: TEMPLATE_NAME, language_code: locale.code })
        .first();

      expect(template, `expected template for locale ${locale.code}`).toBeTruthy();
      expect(template.subject).toBe(locale.subject);
      expect(template.html_content).toContain('{{rating_buttons_html}}');
      expect(template.text_content).toContain('{{rating_links_text}}');
    }
  });

  it('renders locale-specific content and falls back to English', async () => {
    const processor = new DatabaseTemplateProcessor(db, TEMPLATE_NAME);
    const templateData = {
      tenant_name: 'Acme Support',
      ticket_number: 'TCK-1001',
      ticket_subject: 'Printer outage',
      technician_name: 'Alex Doe',
      survey_url: 'https://example.com/surveys/respond/token',
      rating_buttons_html: '<a href="https://example.com/rate/5">5</a>',
      rating_links_text: '5 ★: https://example.com/rate/5',
      rating_scale: 5,
      rating_type: 'stars',
      prompt_text: 'How would you rate your support experience?',
      comment_prompt: 'Share additional feedback (optional).',
      thank_you_text: 'Thank you for helping us improve!',
      expires_at: new Date().toISOString(),
      ticket_closed_at: new Date().toISOString(),
    };

    const french = await processor.process({
      locale: 'fr',
      templateData,
    });
    const frenchTemplate = SUPPORTED_LOCALES.find((locale) => locale.code === 'fr');
    expect(frenchTemplate).toBeDefined();
    const expectedFrenchSubject = frenchTemplate!.subject.replace('{{ticket_number}}', templateData.ticket_number);
    expect(french.subject).toBe(expectedFrenchSubject);
    expect(french.html).toContain(templateData.rating_buttons_html);

    const fallback = await processor.process({
      locale: 'pt',
      templateData,
    });

    const englishTemplate = SUPPORTED_LOCALES.find((locale) => locale.code === 'en');
    expect(englishTemplate).toBeDefined();
    const expectedEnglishSubject = englishTemplate!.subject.replace('{{ticket_number}}', templateData.ticket_number);
    expect(fallback.subject).toBe(expectedEnglishSubject);
    expect(fallback.text).toContain('5 ★: https://example.com/rate/5');
  });
});
