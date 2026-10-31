/**
 * Maps the quote access-link resolver's failure statuses to the page's outcomes.
 * Pure: no tenant or quote data ever enters this module.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { QuoteAccessResolveFailure } from '@alga-psa/billing/services';

export type PublicQuoteOutcome =
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'superseded'
  | 'decided'
  | 'rate_limited';

/** Copy groups under features/billing `quotes.public.outcome.*`. */
export type PublicQuoteOutcomeCopyKey = 'unavailable' | 'expired' | 'superseded' | 'decided';

export function mapResolveFailureToOutcome(status: QuoteAccessResolveFailure): PublicQuoteOutcome {
  switch (status) {
    case 'not_found':
      return 'unknown';
    case 'expired':
    case 'revoked':
    case 'superseded':
    case 'decided':
    case 'rate_limited':
      return status;
    default:
      return 'unknown';
  }
}

/**
 * unknown, revoked and rate_limited deliberately share one copy so the page is
 * not an oracle for whether a token ever existed.
 */
export function outcomeCopyKey(outcome: PublicQuoteOutcome): PublicQuoteOutcomeCopyKey {
  switch (outcome) {
    case 'expired':
      return 'expired';
    case 'superseded':
      return 'superseded';
    case 'decided':
      return 'decided';
    default:
      return 'unavailable';
  }
}

/** HTTP status for surfaces that can set one (the PDF route). Pages always render 200. */
export function outcomeHttpStatus(outcome: PublicQuoteOutcome): number {
  switch (outcome) {
    case 'rate_limited':
      return 429;
    case 'expired':
    case 'revoked':
    case 'superseded':
    case 'decided':
      return 410;
    default:
      return 404;
  }
}

/** Client IP for the resolver's attempt limiter. Never logged. */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || null;
}

/** Same-origin logo only: a relative path or an inline image; anything else would be a third-party request. */
export function sameOriginLogoUrl(url: string | null | undefined): string | null {
  const value = (url ?? '').trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^data:image\//i.test(value)) return value;
  return null;
}

const PUBLIC_QUOTE_NAMESPACES = ['common', 'features/billing'] as const;

/** Server-embedded namespace bundles so the page makes no per-namespace HTTP fetches after hydration. */
export async function loadPublicQuoteResources(
  locale: string,
): Promise<Record<string, Record<string, unknown>>> {
  const dir = path.join(process.cwd(), 'public', 'locales', locale);
  const resources: Record<string, Record<string, unknown>> = {};
  await Promise.all(
    PUBLIC_QUOTE_NAMESPACES.map(async (ns) => {
      try {
        resources[ns] = JSON.parse(await readFile(path.join(dir, `${ns}.json`), 'utf8'));
      } catch {
        // Missing bundle: the client falls back to defaultValue strings.
      }
    }),
  );
  return resources;
}
