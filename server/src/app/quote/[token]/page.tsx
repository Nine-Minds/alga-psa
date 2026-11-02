import { getConnection } from '@alga-psa/db';
import { loadPublicQuoteView, recordQuoteViewedViaEmailLink } from '@alga-psa/billing/services';
import { PublicQuoteReview } from '@alga-psa/client-portal/components';
import { getTenantBrandingByTenantId } from '@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain';
import {
  loadPublicQuoteResources,
  mapResolveFailureToOutcome,
  sameOriginLogoUrl,
} from '../../../lib/quote/publicQuoteOutcome';
import { resolvePublicQuoteRequest } from '../../../lib/quote/publicQuoteRequest';
import PublicQuoteOutcomeView from './PublicQuoteOutcomeView';

// Token-bearing, tenant-resolved-at-request-time page: never cache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// robots / referrer metadata live in layout.tsx (generateMetadata, localised title).

// Token resolution is cached per request (see publicQuoteRequest): the root
// layout's <html lang> and this page share one resolve.

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await resolvePublicQuoteRequest(token);

  if (request.reader === null) {
    return <PublicQuoteOutcomeView outcome={mapResolveFailureToOutcome(request.resolved.status)} />;
  }

  const { resolved, reader } = request;

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

  const { locale } = reader;
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
    />
  );
}
