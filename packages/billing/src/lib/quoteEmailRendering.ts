import Handlebars from 'handlebars';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IQuote } from '@alga-psa/types';
import { formatCurrency } from '@alga-psa/core/lib/formatters';
import {
  buildQuoteAcceptedConfirmationEmailTemplate,
  buildQuoteReminderEmailTemplate,
  buildQuoteSentEmailTemplate,
  formatQuoteDate,
} from './quote-email-templates';

export type QuoteTemplateName = 'quote-email' | 'quote-reminder-email' | 'quote-accepted-confirmation-email';

interface QuoteEmailTemplate {
  subject: string;
  html_content: string;
  text_content: string;
}

const CODE_TEMPLATES = {
  'quote-email': buildQuoteSentEmailTemplate,
  'quote-reminder-email': buildQuoteReminderEmailTemplate,
  'quote-accepted-confirmation-email': buildQuoteAcceptedConfirmationEmailTemplate,
} as const;

// Resolves the quote email template with the same precedence as invoices:
// tenant override (locale, then English) before the system template, so
// customisations made in Notification Settings > Email Templates are honoured.
export const getQuoteEmailTemplate = async (
  knex: Knex | Knex.Transaction,
  tenant: string,
  name: QuoteTemplateName,
  locale: string = 'en'
): Promise<QuoteEmailTemplate | null> => {
  const db = tenantDb(knex, tenant);
  const languages = locale === 'en' ? ['en'] : [locale, 'en'];

  for (const table of ['tenant_email_templates', 'system_email_templates']) {
    for (const language_code of languages) {
      const template = await db.table(table)
        .where({ name, language_code })
        .first<QuoteEmailTemplate | undefined>();

      if (template) {
        return {
          subject: template.subject,
          html_content: template.html_content,
          text_content: template.text_content,
        };
      }
    }
  }

  return null;
};

/**
 * Renders a quote email: the tenant/system DB template when one exists, else the
 * built-in template for that name. Shared by the send/reminder actions and the
 * post-acceptance confirmation so every quote email resolves the same way.
 */
export const renderQuoteEmail = async ({
  knex,
  tenant,
  templateName,
  quote,
  companyName,
  portalLink,
  customMessage,
  locale,
}: {
  knex: Knex;
  tenant: string;
  templateName: QuoteTemplateName;
  quote: IQuote;
  companyName: string;
  portalLink?: string;
  customMessage?: string;
  locale?: string;
}): Promise<{ subject: string; html: string; text: string }> => {
  const template = await getQuoteEmailTemplate(knex, tenant, templateName, locale ?? 'en');

  if (!template) {
    return CODE_TEMPLATES[templateName]({ quote, companyName, portalLink, customMessage, locale });
  }

  const templateContext = {
    quote: {
      number: quote.quote_number ?? quote.quote_id,
      // LEVERAGE: pattern currency-minor-units — hard-coded /100 assumes a 2-digit currency; display/compute formatting should go through formatCurrencyFromMinorUnits (alga0002091 follow-up)
      amount: formatCurrency((quote.total_amount ?? 0) / 100, locale ?? 'en', quote.currency_code || 'USD'),
      validUntil: formatQuoteDate(quote.valid_until ?? null, locale),
      acceptedAt: formatQuoteDate(quote.accepted_at ?? null, locale),
    },
    company: {
      name: companyName,
    },
    portalLink: portalLink?.trim() || '',
    customMessage: customMessage?.trim() || '',
  };

  // Subject and plain-text are not HTML — disable Handlebars' HTML escape so
  // characters like `"` in quote titles don't render as `&quot;`.
  return {
    subject: Handlebars.compile(template.subject, { noEscape: true })(templateContext),
    html: Handlebars.compile(template.html_content)(templateContext),
    text: Handlebars.compile(template.text_content, { noEscape: true })(templateContext),
  };
};
