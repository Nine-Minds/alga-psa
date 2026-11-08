import { formatCurrency } from '@alga-psa/core/lib/formatters';
import { formatLocalizedCalendarDate } from '@alga-psa/core';
import type { IQuote } from '@alga-psa/types';

interface QuoteEmailTemplateInput {
  quote: IQuote;
  companyName: string;
  portalLink?: string;
  /**
   * Per-recipient unauthenticated review link. When present it is the primary
   * call to action and the portal link becomes a secondary link.
   */
  quoteReviewLink?: string;
  /**
   * Whether the recipient can sign in to the client portal. Only consulted when
   * `quoteReviewLink` is present: the secondary portal link is omitted without
   * portal access. Defaults to true.
   */
  hasPortalAccess?: boolean;
  customMessage?: string;
  /** BCP-47 locale for amount formatting; falls back to 'en'. */
  locale?: string;
}

// Quote dates are calendar dates: format the calendar day itself, never
// through the process timezone (which can render the previous day).
export const formatQuoteDate = (value?: string | null, locale?: string): string => {
  if (!value) {
    return 'N/A';
  }

  try {
    return formatLocalizedCalendarDate(value, locale || 'en');
  } catch {
    return 'N/A';
  }
};

// With a review link: it is the primary CTA and the portal link is secondary
// (portal access only). Without one: the portal link is the only link, as before.
function resolveLinks(
  { portalLink, quoteReviewLink, hasPortalAccess }: Pick<QuoteEmailTemplateInput, 'portalLink' | 'quoteReviewLink' | 'hasPortalAccess'>
): { reviewLink?: string; portal?: string } {
  const reviewLink = quoteReviewLink?.trim() || undefined;
  const portal = portalLink?.trim() || undefined;
  if (!reviewLink) {
    return { portal };
  }
  return { reviewLink, portal: hasPortalAccess === false ? undefined : portal };
}

const reviewButtonHtml = (reviewLink: string) =>
  `<p><a href="${reviewLink}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#6366f1;color:#ffffff;font-weight:600;text-decoration:none;">Review and approve quote</a></p>`;

export function buildQuoteSentEmailTemplate({
  quote,
  companyName,
  portalLink,
  quoteReviewLink,
  hasPortalAccess,
  customMessage,
  locale,
}: QuoteEmailTemplateInput): { subject: string; html: string; text: string } {
  const quoteNumber = quote.quote_number ?? quote.quote_id;
  // LEVERAGE: pattern currency-minor-units — hard-coded /100 assumes a 2-digit currency; display/compute formatting should go through formatCurrencyFromMinorUnits (alga0002091 follow-up) (also 2 more identical site(s) in this file)
  const formattedAmount = formatCurrency((quote.total_amount ?? 0) / 100, locale ?? 'en', quote.currency_code || 'USD');
  const validUntil = formatQuoteDate(quote.valid_until ?? null, locale);
  const trimmedMessage = customMessage?.trim();
  const { reviewLink, portal: resolvedPortalLink } = resolveLinks({ portalLink, quoteReviewLink, hasPortalAccess });
  const subject = `Quote ${quoteNumber} from ${companyName}`;

  const htmlSections = [
    '<p>Hello,</p>',
    `<p>Your quote <strong>${quoteNumber}</strong> is attached and ready for review.</p>`,
    '<ul>',
    `<li><strong>Total:</strong> ${formattedAmount}</li>`,
    `<li><strong>Valid Until:</strong> ${validUntil}</li>`,
    '</ul>',
    trimmedMessage ? `<p>${trimmedMessage}</p>` : '',
    reviewLink ? reviewButtonHtml(reviewLink) : '',
    resolvedPortalLink
      ? `<p>You can also review this quote in the client portal: <a href="${resolvedPortalLink}">${resolvedPortalLink}</a></p>`
      : '',
    `<p>Thank you,<br />${companyName}</p>`,
  ];

  const textSections = [
    'Hello,',
    '',
    `Your quote ${quoteNumber} is attached and ready for review.`,
    `Total: ${formattedAmount}`,
    `Valid Until: ${validUntil}`,
    trimmedMessage ? `\n${trimmedMessage}` : '',
    reviewLink ? `\nReview and approve online: ${reviewLink}` : '',
    resolvedPortalLink ? `\nReview online: ${resolvedPortalLink}` : '',
    `\nThank you,\n${companyName}`,
  ];

  return {
    subject,
    html: htmlSections.filter(Boolean).join(''),
    text: textSections.filter(Boolean).join('\n'),
  };
}

export function buildQuoteReminderEmailTemplate({
  quote,
  companyName,
  portalLink,
  quoteReviewLink,
  hasPortalAccess,
  customMessage,
  locale,
}: QuoteEmailTemplateInput): { subject: string; html: string; text: string } {
  const quoteNumber = quote.quote_number ?? quote.quote_id;
  const formattedAmount = formatCurrency((quote.total_amount ?? 0) / 100, locale ?? 'en', quote.currency_code || 'USD');
  const validUntil = formatQuoteDate(quote.valid_until ?? null, locale);
  const trimmedMessage = customMessage?.trim();
  const { reviewLink, portal: resolvedPortalLink } = resolveLinks({ portalLink, quoteReviewLink, hasPortalAccess });
  const subject = `Reminder: Quote ${quoteNumber} expires on ${validUntil}`;

  return {
    subject,
    html: [
      '<p>Hello,</p>',
      `<p>This is a reminder that quote <strong>${quoteNumber}</strong> for ${formattedAmount} expires on <strong>${validUntil}</strong>.</p>`,
      trimmedMessage ? `<p>${trimmedMessage}</p>` : '',
      reviewLink ? reviewButtonHtml(reviewLink) : '',
      resolvedPortalLink
        ? `<p>Review the quote in the client portal: <a href="${resolvedPortalLink}">${resolvedPortalLink}</a></p>`
        : '',
      `<p>Thank you,<br />${companyName}</p>`,
    ].filter(Boolean).join(''),
    text: [
      'Hello,',
      '',
      `This is a reminder that quote ${quoteNumber} for ${formattedAmount} expires on ${validUntil}.`,
      trimmedMessage ? `\n${trimmedMessage}` : '',
      reviewLink ? `\nReview and approve online: ${reviewLink}` : '',
      resolvedPortalLink ? `\nReview online: ${resolvedPortalLink}` : '',
      `\nThank you,\n${companyName}`,
    ].filter(Boolean).join('\n'),
  };
}

export function buildQuoteAcceptedConfirmationEmailTemplate({
  quote,
  companyName,
  portalLink,
  customMessage,
  locale,
}: QuoteEmailTemplateInput): { subject: string; html: string; text: string } {
  const quoteNumber = quote.quote_number ?? quote.quote_id;
  const formattedAmount = formatCurrency((quote.total_amount ?? 0) / 100, locale ?? 'en', quote.currency_code || 'USD');
  const acceptedAt = formatQuoteDate(quote.accepted_at ?? null, locale);
  const trimmedMessage = customMessage?.trim();
  const resolvedPortalLink = portalLink?.trim();
  const subject = `Quote ${quoteNumber} was accepted`;

  return {
    subject,
    html: [
      '<p>Hello,</p>',
      `<p>Quote <strong>${quoteNumber}</strong> has been accepted for <strong>${formattedAmount}</strong>.</p>`,
      `<p><strong>Accepted On:</strong> ${acceptedAt}</p>`,
      trimmedMessage ? `<p>${trimmedMessage}</p>` : '',
      resolvedPortalLink ? `<p>Review the accepted quote: <a href="${resolvedPortalLink}">${resolvedPortalLink}</a></p>` : '',
      `<p>Thank you,<br />${companyName}</p>`,
    ].filter(Boolean).join(''),
    text: [
      'Hello,',
      '',
      `Quote ${quoteNumber} has been accepted for ${formattedAmount}.`,
      `Accepted On: ${acceptedAt}`,
      trimmedMessage ? `\n${trimmedMessage}` : '',
      resolvedPortalLink ? `\nReview online: ${resolvedPortalLink}` : '',
      `\nThank you,\n${companyName}`,
    ].filter(Boolean).join('\n'),
  };
}
