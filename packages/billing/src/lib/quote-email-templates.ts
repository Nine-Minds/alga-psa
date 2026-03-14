import { formatCurrency } from '@alga-psa/core/lib/formatters';
import type { IQuote } from '@alga-psa/types';

interface QuoteEmailTemplateInput {
  quote: IQuote;
  companyName: string;
  portalLink?: string;
  customMessage?: string;
}

const formatQuoteDate = (value?: string | null): string => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export function buildQuoteSentEmailTemplate({
  quote,
  companyName,
  portalLink,
  customMessage,
}: QuoteEmailTemplateInput): { subject: string; html: string; text: string } {
  const quoteNumber = quote.quote_number ?? quote.quote_id;
  const formattedAmount = formatCurrency((quote.total_amount ?? 0) / 100, 'en-US', quote.currency_code || 'USD');
  const validUntil = formatQuoteDate(quote.valid_until ?? null);
  const trimmedMessage = customMessage?.trim();
  const resolvedPortalLink = portalLink?.trim();
  const subject = `Quote ${quoteNumber} from ${companyName}`;

  const htmlSections = [
    '<p>Hello,</p>',
    `<p>Your quote <strong>${quoteNumber}</strong> is attached and ready for review.</p>`,
    '<ul>',
    `<li><strong>Total:</strong> ${formattedAmount}</li>`,
    `<li><strong>Valid Until:</strong> ${validUntil}</li>`,
    '</ul>',
    trimmedMessage ? `<p>${trimmedMessage}</p>` : '',
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
  customMessage,
}: QuoteEmailTemplateInput): { subject: string; html: string; text: string } {
  const quoteNumber = quote.quote_number ?? quote.quote_id;
  const formattedAmount = formatCurrency((quote.total_amount ?? 0) / 100, 'en-US', quote.currency_code || 'USD');
  const validUntil = formatQuoteDate(quote.valid_until ?? null);
  const trimmedMessage = customMessage?.trim();
  const resolvedPortalLink = portalLink?.trim();
  const subject = `Reminder: Quote ${quoteNumber} expires on ${validUntil}`;

  return {
    subject,
    html: [
      '<p>Hello,</p>',
      `<p>This is a reminder that quote <strong>${quoteNumber}</strong> for ${formattedAmount} expires on <strong>${validUntil}</strong>.</p>`,
      trimmedMessage ? `<p>${trimmedMessage}</p>` : '',
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
      resolvedPortalLink ? `\nReview online: ${resolvedPortalLink}` : '',
      `\nThank you,\n${companyName}`,
    ].filter(Boolean).join('\n'),
  };
}
