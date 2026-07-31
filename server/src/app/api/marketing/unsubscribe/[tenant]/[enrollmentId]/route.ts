import { NextRequest, NextResponse } from 'next/server';
import { unsubscribeEnrollmentInternal } from '@alga-psa/marketing/lib';
import { resolvePublicMarketingTenant } from '@/lib/marketing/publicEndpoints';
import logger from '@alga-psa/core/logger';

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
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

function confirmPage(): string {
  // Same visual shell as htmlPage, plus the POST form — the GET must never
  // mutate (mail scanners prefetch every link in an email), so the actual
  // unsubscribe is behind this button.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribe</title>
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
    <h1>Unsubscribe from these emails?</h1>
    <p>You will no longer receive marketing emails at this address.</p>
    <form method="post">
      <button type="submit">Unsubscribe</button>
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
    return htmlResponse(
      htmlPage('Link unavailable', 'This link is no longer valid.'),
      404
    );
  }

  return htmlResponse(confirmPage());
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
    return htmlResponse(
      htmlPage('Link unavailable', 'This link is no longer valid.'),
      404
    );
  }

  try {
    const result = await unsubscribeEnrollmentInternal(ctx.knex, ctx.tenantId, enrollmentId);
    if (!result) {
      return htmlResponse(
        htmlPage('Link unavailable', 'This link is no longer valid.')
      );
    }
    logger.info('[marketing-unsubscribe] Enrollment unsubscribed', { tenantId: ctx.tenantId });
    return htmlResponse(
      htmlPage("You've been unsubscribed", 'You will no longer receive these emails.')
    );
  } catch (error) {
    logger.error('[marketing-unsubscribe] Unsubscribe failed', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return htmlResponse(
      htmlPage('Link unavailable', 'This link is no longer valid.')
    );
  }
}

export const runtime = 'nodejs';
