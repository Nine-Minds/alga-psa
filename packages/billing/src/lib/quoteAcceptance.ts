import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { SYSTEM_DATE_FORMAT, type CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { formatDateValue } from '@alga-psa/ui/lib/i18n/formatDateValue';
import type { QuoteViewModelAcceptance } from '@alga-psa/types';
import type { TemplateLabelTranslator } from './invoice-template-ast/i18nLabels';

/**
 * How a quote acceptance is described to the document renderer. Built from the
 * `quote_decisions` audit row by `loadQuoteAcceptance`; that row, not
 * `quotes.accepted_by`, records a signer who has no `users` row.
 */
export interface QuoteAcceptanceDetails {
  /** The name the signer typed. Wins over every looked-up name. */
  signerName?: string | null;
  signerEmail?: string | null;
  signerTitle?: string | null;
  /** The signer's contact, when the emailed link was issued to one. */
  signerContactId?: string | null;
  acceptedAt: string | Date;
  method: string;
  ipAddress?: string | null;
}

type AcceptedDecisionRow = {
  decision_id: string;
  method: string;
  contact_id: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signer_title: string | null;
  ip: string | null;
  decided_at: Date | string;
};

/**
 * The acceptance recorded for a quote: the named `quote_decisions` row, or the
 * newest `accepted` row when no id is given. Null when the quote has no
 * recorded acceptance (or the named row is not an acceptance of this quote).
 */
export async function loadQuoteAcceptance(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
  options: { decisionId?: string | null } = {}
): Promise<QuoteAcceptanceDetails | null> {
  const query = tenantDb(knexOrTrx, tenant)
    .table('quote_decisions')
    .where({ quote_id: quoteId, decision: 'accepted' });
  if (options.decisionId) {
    query.andWhere({ decision_id: options.decisionId });
  }
  const row = await query
    .orderBy('decided_at', 'desc')
    .first<AcceptedDecisionRow | undefined>(
      'decision_id', 'method', 'contact_id', 'signer_name', 'signer_email', 'signer_title', 'ip', 'decided_at',
    );
  if (!row) {
    return null;
  }
  return {
    signerName: row.signer_name,
    signerEmail: row.signer_email,
    signerTitle: row.signer_title,
    signerContactId: row.contact_id,
    acceptedAt: row.decided_at,
    method: row.method,
    ipAddress: row.ip,
  };
}

/** Render-time extras that are about presentation, not about the acceptance. */
export interface QuoteAcceptanceRenderOptions {
  /** IANA zone the acceptance time is written in (the tenant's). */
  timeZone?: string | null;
}

/** Method code -> `documents` label key (and its English default). */
const METHOD_LABELS: Record<string, { key: string; defaultValue: string }> = {
  email_link: { key: 'labels.quoteAcceptance.methods.emailLink', defaultValue: 'Emailed link' },
  portal: { key: 'labels.quoteAcceptance.methods.portal', defaultValue: 'Client portal' },
  msp_marked: { key: 'labels.quoteAcceptance.methods.msp', defaultValue: 'Recorded by MSP' },
};

/** The `documents` namespace translator; absent means English defaults. */
export type AcceptanceLabelTranslator = TemplateLabelTranslator;

export const toAcceptanceIso = (value: string | Date): string | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const trimmed = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
};

/**
 * The acceptance fields on the quote view model, for templates to bind and for
 * the shared signature block. `resolvedSignerName` is the output of the single
 * accepted-by resolver, so the block and `accepted_by_name` always agree.
 */
export function buildQuoteViewModelAcceptance(
  details: QuoteAcceptanceDetails,
  resolvedSignerName: string | null
): QuoteViewModelAcceptance | null {
  const acceptedAt = toAcceptanceIso(details.acceptedAt);
  if (!acceptedAt) {
    return null;
  }

  return {
    signer_name: resolvedSignerName ?? '',
    signer_email: trimmed(details.signerEmail),
    signer_title: trimmed(details.signerTitle),
    accepted_at: acceptedAt,
    method: details.method,
    ip_address: trimmed(details.ipAddress),
  };
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The acceptance time as the tenant reads it: the tenant time zone, with the
 * recipient country's digit order and clock, through the same formatter the
 * template renderer uses for every other date.
 */
export function formatAcceptanceTimestamp(
  isoTimestamp: string,
  options: { locale?: string; dateFormat?: CountryDateFormat; timeZone?: string | null }
): string {
  return formatDateValue(
    isoTimestamp,
    options.locale || 'en',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: trimmed(options.timeZone) ?? 'UTC',
      timeZoneName: 'short',
    },
    options.dateFormat ?? SYSTEM_DATE_FORMAT
  );
}

/**
 * The acceptance block appended to a signed quote copy. Plain HTML with inline
 * styles so it renders the same under every template, standard or custom: it is
 * a stamp on the finished document, not part of any template.
 */
export function renderQuoteAcceptanceBlockHtml(
  acceptance: QuoteViewModelAcceptance,
  options: {
    locale?: string;
    dateFormat?: CountryDateFormat;
    timeZone?: string | null;
    /** Same `documents` translator the template labels use; English when absent. */
    t?: AcceptanceLabelTranslator;
  } = {}
): string {
  const label = (key: string, defaultValue: string): string =>
    options.t ? options.t(`labels.quoteAcceptance.${key}`, { defaultValue }) : defaultValue;
  const method = METHOD_LABELS[acceptance.method];

  const rows: Array<[string, string | null | undefined]> = [
    [label('signedBy', 'Signed by'), acceptance.signer_name],
    [label('email', 'Email'), acceptance.signer_email],
    [label('jobTitle', 'Title'), acceptance.signer_title],
    [label('acceptedOn', 'Accepted on'), formatAcceptanceTimestamp(acceptance.accepted_at, options)],
    [
      label('method', 'Method'),
      method
        ? (options.t ? options.t(method.key, { defaultValue: method.defaultValue }) : method.defaultValue)
        : acceptance.method,
    ],
    [label('ipAddress', 'IP address'), acceptance.ip_address],
  ];

  const body = rows
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(
      ([label, value]) =>
        `<tr><th style="text-align:left;padding:2px 12px 2px 0;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</th><td style="padding:2px 0;">${escapeHtml(value as string)}</td></tr>`
    )
    .join('');

  return [
    '<section data-quote-acceptance-block="true" style="margin:24px 0 0;padding:12px 16px;border:1px solid #9ca3af;border-radius:4px;font-family:inherit;font-size:12px;break-inside:avoid;page-break-inside:avoid;">',
    `<h2 style="margin:0 0 8px;font-size:14px;">${escapeHtml(label('title', 'Quote accepted'))}</h2>`,
    `<table style="border-collapse:collapse;"><tbody>${body}</tbody></table>`,
    '</section>',
  ].join('');
}

/** Insert the acceptance block at the end of the rendered document body. */
export function appendAcceptanceBlockToHtmlDocument(htmlDocument: string, blockHtml: string): string {
  const bodyClose = htmlDocument.lastIndexOf('</body>');
  if (bodyClose === -1) {
    return `${htmlDocument}${blockHtml}`;
  }
  return `${htmlDocument.slice(0, bodyClose)}${blockHtml}${htmlDocument.slice(bodyClose)}`;
}
