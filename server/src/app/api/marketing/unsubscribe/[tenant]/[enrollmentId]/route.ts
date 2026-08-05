import { NextRequest, NextResponse } from 'next/server';
import type { TFunction } from 'i18next';
import { unsubscribeEnrollmentInternal } from '@alga-psa/marketing/lib';
import { resolvePublicMarketingTenant } from '@/lib/marketing/publicEndpoints';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import logger from '@alga-psa/core/logger';

interface PageStrings {
  locale: string;
  t: TFunction;
}

/**
 * Resolve the language for the recipient of a marketing email.
 *
 * Always passes an options object so the hierarchical (session-backed)
 * resolver is skipped — this endpoint is public and the visitor has no Alga
 * session. That leaves: locale cookie → tenant client-portal default → tenant
 * default → Accept-Language → English. Deliberately does NOT consult the
 * enrollment/contact: the GET never looks the enrollment up (so link-scanning
 * mail clients cannot probe for existence), and resolving per-contact here
 * would turn the page's language into exactly that existence oracle.
 */
async function pageStrings(tenantId?: string): Promise<PageStrings> {
  const locale = await getServerLocale({ tenantId });
  const { t } = await getServerTranslation(locale, 'common');
  return { locale, t };
}

function htmlPage({ locale }: PageStrings, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           background: #f8fafc; color: #0f172a; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
            padding: 2.5rem 3rem; max-width: 28rem; text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { font-size: 0.95rem; color: #475569; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function unavailablePage(strings: PageStrings): string {
  return htmlPage(
    strings,
    strings.t('pages.unsubscribe.unavailableTitle'),
    strings.t('pages.unsubscribe.unavailableDescription')
  );
}

function confirmPage({ locale, t }: PageStrings): string {
  // Same visual shell as htmlPage, plus the POST form — the GET must never
  // mutate (mail scanners prefetch every link in an email), so the actual
  // unsubscribe is behind this button.
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t('pages.unsubscribe.pageTitle')}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           background: #f8fafc; color: #0f172a; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
            padding: 2.5rem 3rem; max-width: 28rem; text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { font-size: 0.95rem; color: #475569; margin: 0 0 1.25rem; }
    button { background: #0f172a; color: #ffffff; border: 0; border-radius: 6px;
             padding: 0.6rem 1.5rem; font-size: 0.95rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${t('pages.unsubscribe.confirmTitle')}</h1>
    <p>${t('pages.unsubscribe.confirmDescription')}</p>
    <form method="post">
      <button type="submit">${t('pages.unsubscribe.confirmAction')}</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * GET /api/marketing/unsubscribe/[tenant]/[enrollmentId]
 *
 * Public unsubscribe landing for sequence emails (F050/F051). GET only
 * renders a confirmation page — it never changes state, so link-prefetching
 * mail scanners can't silently unsubscribe recipients. Unknown tenants get a
 * generic "no longer valid" page; enrollment existence is never revealed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenant: string; enrollmentId: string }> }
) {
  const { tenant: tenantParam } = await params;

  const ctx = await resolvePublicMarketingTenant(tenantParam);
  if (!ctx) {
    return htmlResponse(unavailablePage(await pageStrings()), 404);
  }

  return htmlResponse(confirmPage(await pageStrings(ctx.tenantId)));
}

/**
 * POST /api/marketing/unsubscribe/[tenant]/[enrollmentId]
 *
 * Performs the unsubscribe: adds the contact's email to the tenant
 * suppression list, stopping all further sends. Serves both the
 * confirmation-page form and RFC 8058 one-click POSTs (List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click) from mail clients. Unknown enrollments get a
 * generic "no longer valid" page — the response never reveals whether an
 * enrollment exists.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tenant: string; enrollmentId: string }> }
) {
  const { tenant: tenantParam, enrollmentId } = await params;

  const ctx = await resolvePublicMarketingTenant(tenantParam);
  if (!ctx) {
    return htmlResponse(unavailablePage(await pageStrings()), 404);
  }

  const strings = await pageStrings(ctx.tenantId);

  try {
    const result = await unsubscribeEnrollmentInternal(ctx.knex, ctx.tenantId, enrollmentId);
    if (!result) {
      return htmlResponse(unavailablePage(strings));
    }
    logger.info('[marketing-unsubscribe] Enrollment unsubscribed', { tenantId: ctx.tenantId });
    return htmlResponse(
      htmlPage(
        strings,
        strings.t('pages.unsubscribe.doneTitle'),
        strings.t('pages.unsubscribe.doneDescription')
      )
    );
  } catch (error) {
    logger.error('[marketing-unsubscribe] Unsubscribe failed', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return htmlResponse(unavailablePage(strings));
  }
}

export const runtime = 'nodejs';
