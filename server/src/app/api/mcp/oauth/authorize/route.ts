/**
 * MCP OAuth Authorization endpoint (EE). GET validates the request and either
 * redirects to login, shows a consent screen, or (if already consented) issues a
 * code; POST applies the consent decision. Logic via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { TFunction } from 'i18next';
import { isEnterpriseEdition } from '@/lib/features';
import { createEditionGateResponseBody, EDITION_GATE_CODE } from '@/lib/editionGating/types';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

interface PageStrings {
  locale: string;
  t: TFunction;
}

/**
 * Consent is only ever shown to a signed-in Alga user (the `login` plan
 * redirects otherwise), so the standard hierarchical resolver applies: user
 * preference → org default → Accept-Language → English. The error page can be
 * reached pre-login, where the same chain falls back to cookie/header.
 */
async function pageStrings(): Promise<PageStrings> {
  const locale = await getServerLocale();
  const { t } = await getServerTranslation(locale, 'common');
  return { locale, t };
}

function errorPage({ locale, t }: PageStrings, message: string, status: number, code?: string): NextResponse {
  const title = escapeHtml(t('pages.mcpAuthorize.errorTitle'));
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">${title}</h1>
<p>${escapeHtml(message)}</p></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(code ? { 'X-Alga-Error-Code': code } : {}),
      ...NO_STORE,
    },
  });
}

function consentPage(
  { locale, t }: PageStrings,
  params: { clientName: string | null; clientId: string; signedRequest: string; tenant: string },
): NextResponse {
  const name = escapeHtml(params.clientName || params.clientId);
  // i18next runs with escapeValue:false (React escapes elsewhere), so `name`
  // is pre-escaped above and the request/scope copy carries its own markup.
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${escapeHtml(t('pages.mcpAuthorize.documentTitle', { client: params.clientName || params.clientId }))}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <h1 style="font-size:1.25rem">${escapeHtml(t('pages.mcpAuthorize.consentTitle'))}</h1>
  <p>${t('pages.mcpAuthorize.consentRequest', { client: name })}</p>
  <p>${t('pages.mcpAuthorize.consentScope')}</p>
  <form method="post" style="display:flex;gap:.75rem;margin-top:1.5rem">
    <input type="hidden" name="signed_request" value="${escapeHtml(params.signedRequest)}" />
    <button name="decision" value="approve" style="padding:.5rem 1rem;background:#4f46e5;color:#fff;border:0;border-radius:.375rem;cursor:pointer">${escapeHtml(t('pages.mcpAuthorize.approve'))}</button>
    <button name="decision" value="deny" style="padding:.5rem 1rem;background:#e5e7eb;border:0;border-radius:.375rem;cursor:pointer">${escapeHtml(t('pages.mcpAuthorize.deny'))}</button>
  </form>
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return errorPage(await pageStrings(), createEditionGateResponseBody('mcp').message, 403, EDITION_GATE_CODE);
  }
  const { prepareAuthorize, resolvePublicBaseUrl } = await import('@product/mcp/entry');
  const base = await resolvePublicBaseUrl(req);
  const publicUrl = new URL(`${base}${req.nextUrl.pathname}${req.nextUrl.search}`);

  const plan = await prepareAuthorize(base, publicUrl);
  switch (plan.kind) {
    case 'error':
      return errorPage(await pageStrings(), plan.message, plan.status);
    case 'login':
    case 'redirect':
      return NextResponse.redirect(plan.location, { status: 302, headers: NO_STORE });
    case 'consent':
      return consentPage(await pageStrings(), plan);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return errorPage(await pageStrings(), createEditionGateResponseBody('mcp').message, 403, EDITION_GATE_CODE);
  }
  const { completeAuthorize, resolvePublicBaseUrl } = await import('@product/mcp/entry');
  const base = await resolvePublicBaseUrl(req);

  const form = await req.formData();
  const signedRequest = String(form.get('signed_request') ?? '');
  const approve = String(form.get('decision') ?? '') === 'approve';

  const decision = await completeAuthorize(base, signedRequest, approve);
  if (decision.kind === 'error') return errorPage(await pageStrings(), decision.message, decision.status);
  return NextResponse.redirect(decision.location, { status: 302, headers: NO_STORE });
}
