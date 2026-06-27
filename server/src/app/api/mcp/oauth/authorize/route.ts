/**
 * MCP OAuth Authorization endpoint (EE). GET validates the request and either
 * redirects to login, shows a consent screen, or (if already consented) issues a
 * code; POST applies the consent decision. Logic via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function errorPage(message: string, status: number): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><title>Authorization error</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Authorization error</h1>
<p>${escapeHtml(message)}</p></body>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

function consentPage(params: { clientName: string | null; clientId: string; signedRequest: string; tenant: string }): NextResponse {
  const name = escapeHtml(params.clientName || params.clientId);
  const html = `<!doctype html><meta charset="utf-8"><title>Authorize ${name}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <h1 style="font-size:1.25rem">Authorize access</h1>
  <p><strong>${name}</strong> is requesting access to AlgaPSA <em>as you</em>.</p>
  <p>It will be able to use the MCP tools with your own permissions in this workspace. You can disconnect it anytime from Settings &rarr; MCP.</p>
  <form method="post" style="display:flex;gap:.75rem;margin-top:1.5rem">
    <input type="hidden" name="signed_request" value="${escapeHtml(params.signedRequest)}" />
    <button name="decision" value="approve" style="padding:.5rem 1rem;background:#4f46e5;color:#fff;border:0;border-radius:.375rem;cursor:pointer">Approve</button>
    <button name="decision" value="deny" style="padding:.5rem 1rem;background:#e5e7eb;border:0;border-radius:.375rem;cursor:pointer">Deny</button>
  </form>
</body>`;
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return errorPage('Not found.', 404);
  const { prepareAuthorize, resolvePublicBaseUrl, isAuthServerEnabled } = await import('@product/mcp/entry');
  if (!(await isAuthServerEnabled())) return errorPage('Not found.', 404);
  const base = await resolvePublicBaseUrl(req);
  const publicUrl = new URL(`${base}${req.nextUrl.pathname}${req.nextUrl.search}`);

  const plan = await prepareAuthorize(base, publicUrl);
  switch (plan.kind) {
    case 'error':
      return errorPage(plan.message, plan.status);
    case 'login':
    case 'redirect':
      return NextResponse.redirect(plan.location, { status: 302, headers: NO_STORE });
    case 'consent':
      return consentPage(plan);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return errorPage('Not found.', 404);
  const { completeAuthorize, resolvePublicBaseUrl, isAuthServerEnabled } = await import('@product/mcp/entry');
  if (!(await isAuthServerEnabled())) return errorPage('Not found.', 404);
  const base = await resolvePublicBaseUrl(req);

  const form = await req.formData();
  const signedRequest = String(form.get('signed_request') ?? '');
  const approve = String(form.get('decision') ?? '') === 'approve';

  const decision = await completeAuthorize(base, signedRequest, approve);
  if (decision.kind === 'error') return errorPage(decision.message, decision.status);
  return NextResponse.redirect(decision.location, { status: 302, headers: NO_STORE });
}
