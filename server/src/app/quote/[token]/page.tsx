import { cache } from 'react';
import { headers } from 'next/headers.js';
import { getConnection } from '@alga-psa/db';
import {
  QuoteAccessLinks,
  fingerprintPublicQuoteView,
  getCurrentQuoteAgreement,
  loadPublicQuoteView,
  recordQuoteViewedViaEmailLink,
  resolveQuoteRecipientLocale,
} from '@alga-psa/billing/services';
import { PublicQuoteReview } from '@alga-psa/client-portal/components';
import { getTenantBrandingByTenantId } from '@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain';
import { normalizeLocale } from '@alga-psa/core/i18n/config';
import {
  clientIpFromHeaders,
  loadPublicQuoteResources,
  mapResolveFailureToOutcome,
  sameOriginLogoUrl,
} from '../../../lib/quote/publicQuoteOutcome';
import PublicQuoteOutcomeView from './PublicQuoteOutcomeView';

// Token-bearing, tenant-resolved-at-request-time page: never cache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// robots / referrer metadata live in layout.tsx (generateMetadata, localised title).

/**
 * `resolve` is not a pure read (it bumps last_used_at / use_count and consumes
 * rate-limit budget), so it must run exactly once per request. React cache()
 * dedupes it across everything that renders for this request.
 */
const resolveToken = cache(async (token: string) => {
  const ip = clientIpFromHeaders(await headers());
  return QuoteAccessLinks.resolve(token, { ip });
});

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (resolved.status !== 'ok') {
    return <PublicQuoteOutcomeView outcome={mapResolveFailureToOutcome(resolved.status)} />;
  }

  const { tenant, link, recipient, readOnly } = resolved;
  const knex = await getConnection(tenant);

  // Allow-listed projection: nothing MSP-only can reach the client bundle.
  const view = await loadPublicQuoteView(knex, tenant, resolved.quote.quote_id);
  if (!view) {
    return <PublicQuoteOutcomeView outcome="unknown" />;
  }

  // View telemetry: ok only, debounced per (link, minute). Never blocks the page.
  try {
    await recordQuoteViewedViaEmailLink(knex, tenant, {
      quoteId: view.quote.quote_id,
      linkId: link.link_id,
      recipientEmail: recipient.email,
    });
  } catch {
    console.error('[public-quote] failed to record quote view');
  }

  const locale = normalizeLocale(await resolveQuoteRecipientLocale(knex, tenant, recipient)) ?? 'en';
  const [resources, branding] = await Promise.all([
    loadPublicQuoteResources(locale),
    getTenantBrandingByTenantId(tenant).catch(() => null),
  ]);

  const status = view.quote.status;
  const decidedNotice = readOnly
    ? status === 'rejected'
      ? 'declined'
      : status === 'converted'
        ? 'converted'
        : 'accepted'
    : null;

  return (
    <PublicQuoteReview
      quote={view.quote as any}
      items={view.items}
      locations={view.locations as any}
      locale={locale}
      resources={resources}
      branding={{
        name: branding?.clientName?.trim() || null,
        logoUrl: sameOriginLogoUrl(branding?.logoUrl),
      }}
      pdfHref={`/api/quote/${token}/pdf`}
      decidedNotice={decidedNotice}
      token={token}
      quoteFingerprint={fingerprintPublicQuoteView(view)}
      agreement={getCurrentQuoteAgreement()}
    />
  );
}
