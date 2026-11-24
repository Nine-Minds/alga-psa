import Handlebars from 'handlebars';
import { tenantDb } from '@alga-psa/db';
import { templateVariables } from '@alga-psa/email/branding';
import { lookupEmailTemplate } from '@alga-psa/email/templateLookup';
import type { Knex } from 'knex';
import type { IQuote } from '@alga-psa/types';
import { formatCurrency } from '@alga-psa/core/formatters';
import {
  buildQuoteAcceptedConfirmationEmailTemplate,
  buildQuoteReminderEmailTemplate,
  buildQuoteSentEmailTemplate,
  formatQuoteDate,
} from './quote-email-templates';

export type QuoteTemplateName = 'quote-email' | 'quote-reminder-email' | 'quote-accepted-confirmation-email';

export interface QuoteEmailTemplate {
  subject: string;
  html_content: string;
  text_content: string;
}

const CODE_TEMPLATES = {
  'quote-email': buildQuoteSentEmailTemplate,
  'quote-reminder-email': buildQuoteReminderEmailTemplate,
  'quote-accepted-confirmation-email': buildQuoteAcceptedConfirmationEmailTemplate,
} as const;

export const REVIEW_LINK_VARIABLE = 'quoteReviewLink';

// Resolves the quote email template through the same resolver every other email uses: the tenant's
// own template (recipient language, then English) before the system one, so customisations made in
// Notification Settings > Email Templates are honoured, and a branded copy nobody edited is served
// as the current system template in the tenant's brand (see lookupEmailTemplate).
// LEVERAGE: pattern tenant-then-system template lookup — this was the third private copy (see also EmailNotificationService.getEffectiveTemplate); the resolver is the one layer
export const getQuoteEmailTemplate = async (
  knex: Knex | Knex.Transaction,
  tenant: string,
  name: QuoteTemplateName,
  locale: string = 'en'
): Promise<QuoteEmailTemplate | null> => {
  const found = await lookupEmailTemplate(tenantDb(knex, tenant), name, locale);
  if (!found) return null;
  const { template } = found;
  return {
    subject: template.subject ?? '',
    html_content: template.html_content,
    text_content: template.text_content ?? '',
  };
};

const templateReferencesReviewLink = (source: string): boolean => templateVariables(source).has(REVIEW_LINK_VARIABLE);

export interface ResolvedQuoteEmail {
  templateName: QuoteTemplateName;
  locale: string;
  template: QuoteEmailTemplate | null;
  htmlRendersReviewLink: boolean;
  textRendersReviewLink: boolean;
  rendersReviewLink: boolean;
}

export const resolveQuoteEmail = async (
  knex: Knex | Knex.Transaction,
  tenant: string,
  templateName: QuoteTemplateName,
  locale: string
): Promise<ResolvedQuoteEmail> => {
  const template = await getQuoteEmailTemplate(knex, tenant, templateName, locale);
  if (!template) {
    return { templateName, locale, template: null, htmlRendersReviewLink: true, textRendersReviewLink: true, rendersReviewLink: true };
  }
  const htmlRendersReviewLink = templateReferencesReviewLink(template.html_content);
  const textRendersReviewLink = templateReferencesReviewLink(template.text_content);
  return {
    templateName, locale, template, htmlRendersReviewLink, textRendersReviewLink,
    rendersReviewLink: htmlRendersReviewLink || textRendersReviewLink,
  };
};

export const renderResolvedQuoteEmail = ({
  resolved,
  quote,
  companyName,
  portalLink,
  quoteReviewLink,
  hasPortalAccess,
  customMessage,
}: {
  resolved: ResolvedQuoteEmail;
  quote: IQuote;
  companyName: string;
  portalLink?: string;
  quoteReviewLink?: string;
  hasPortalAccess?: boolean;
  customMessage?: string;
}): { subject: string; html: string; text: string } => {
  const { template, templateName, locale } = resolved;
  if (!template) {
    return CODE_TEMPLATES[templateName]({ quote, companyName, portalLink, quoteReviewLink, hasPortalAccess, customMessage, locale });
  }

  const baseContext = {
    quote: {
      number: quote.quote_number ?? quote.quote_id,
      // LEVERAGE: pattern currency-minor-units — hard-coded /100 assumes a 2-digit currency; display/compute formatting should go through formatCurrencyFromMinorUnits (alga0002091 follow-up)
      amount: formatCurrency((quote.total_amount ?? 0) / 100, locale, quote.currency_code || 'USD'),
      validUntil: formatQuoteDate(quote.valid_until ?? null, locale),
      acceptedAt: formatQuoteDate(quote.accepted_at ?? null, locale),
    },
    company: { name: companyName },
    quoteReviewLink: quoteReviewLink?.trim() || '',
    customMessage: customMessage?.trim() || '',
  };
  const contextFor = (partRendersReviewLink: boolean) => ({
    ...baseContext,
    portalLink: (quoteReviewLink && hasPortalAccess === false && partRendersReviewLink ? '' : portalLink?.trim()) || '',
  });
  return {
    subject: Handlebars.compile(template.subject, { noEscape: true })(contextFor(false)),
    html: Handlebars.compile(template.html_content)(contextFor(resolved.htmlRendersReviewLink)),
    text: Handlebars.compile(template.text_content, { noEscape: true })(contextFor(resolved.textRendersReviewLink)),
  };
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
