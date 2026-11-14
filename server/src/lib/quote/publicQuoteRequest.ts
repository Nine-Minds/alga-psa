/**
 * Per-request resolution for the public quote review page.
 *
 * Three parts of one request need the token's answer: the page, its
 * generateMetadata (the localised title) and the root layout (`<html lang>`, via
 * the route locale resolver in ./publicQuoteRouteLocale). `QuoteAccessLinks.resolve` is not
 * a pure read (it bumps last_used_at / use_count and spends rate-limit budget),
 * so everything here goes through React cache(): one resolve per request, no
 * matter which of them asks first.
 */
import { cache } from 'react';
import { headers } from 'next/headers.js';
import { getConnection } from '@alga-psa/db';
import {
  QuoteAccessLinks,
  resolveQuoteRecipientLocale,
  type QuoteAccessResolveResult,
} from '@alga-psa/billing/services';
import { normalizeLocale, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { clientIpFromHeaders } from './publicQuoteOutcome';

export interface PublicQuoteReader {
  locale: SupportedLocale;
}

export type PublicQuoteRequest =
  | { resolved: Extract<QuoteAccessResolveResult, { status: 'ok' }>; reader: PublicQuoteReader }
  | { resolved: Exclude<QuoteAccessResolveResult, { status: 'ok' }>; reader: null };

/**
 * The token's resolve plus who the page is written for (the recipient's
 * language). `reader` is null when the token does not resolve; outcome pages
 * carry no recipient data and keep the request's own locale.
 */
export const resolvePublicQuoteRequest = cache(async (token: string): Promise<PublicQuoteRequest> => {
  const resolved = await QuoteAccessLinks.resolve(token, { ip: clientIpFromHeaders(await headers()) });
  if (resolved.status !== 'ok') return { resolved, reader: null };

  const { tenant, recipient } = resolved;
  const knex = await getConnection(tenant);
  const locale = normalizeLocale(await resolveQuoteRecipientLocale(knex, tenant, recipient)) ?? 'en';
  return { resolved, reader: { locale } };
});
