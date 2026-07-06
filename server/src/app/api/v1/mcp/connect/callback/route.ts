/**
 * "Connect with Microsoft/Google" — callback (EE). The IdP redirects the popup
 * here. This route is INERT: it validates the state+cookie+session, exchanges the
 * code for an id_token, and postMessages the resolved {issuer, subject, label} to
 * the opener (the MCP settings screen), then closes. It creates NOTHING — agent
 * provisioning stays behind the admin-authed POST /api/v1/mcp/agents.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Must match CONNECT_STATE_COOKIE in ee/server/src/lib/mcp/connectOAuth.ts.
const STATE_COOKIE = 'mcp_connect_state';

/** A tiny HTML page that posts the result to window.opener (mirrors the email OAuth callback). */
function postMessageHtml(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Connecting…</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:24px">
<p id="s">Completing sign-in…</p>
<script>(function(){try{var p=JSON.parse(atob('${encoded}'));var t=window.opener||window.parent;if(t&&t!==window){t.postMessage(p,window.location.origin);}}catch(e){}try{window.close();}catch(_){}setTimeout(function(){var s=document.getElementById('s');if(s)s.textContent='You can close this window.';},150);})();</script>
</body></html>`;
}

function htmlResponse(html: string, clearCookie = false): NextResponse {
  const res = new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  if (clearCookie) res.cookies.set({ name: STATE_COOKIE, value: '', path: '/api/v1/mcp/connect', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const oauthError = sp.get('error');

  // Best-effort provider read from state, purely to label the postMessage envelope
  // so the opener's listener can match it. The real validation is in the seam.
  let provider: string | null = null;
  try {
    provider = JSON.parse(Buffer.from(state ?? '', 'base64').toString())?.provider ?? null;
  } catch {
    /* ignore — validated below */
  }

  const fail = (error: string) =>
    htmlResponse(postMessageHtml({ type: 'oauth-callback', provider, success: false, error }), true);

  if (!isEnterpriseEdition()) return fail('The MCP server is an Enterprise feature.');
  if (oauthError) return fail(sp.get('error_description') || oauthError);
  if (!code || !state) return fail('Missing authorization code or state.');

  const { authenticateMcpAdmin, completeConnectCallback } = await import('@product/mcp/entry');
  // The popup carries the admin session cookie (same-origin top-level navigation).
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return fail('Your admin session has expired — reopen settings and try again.');

  try {
    const cookieState = req.cookies.get(STATE_COOKIE)?.value;
    const identity = await completeConnectCallback({
      code,
      state,
      cookieState,
      baseUrl: req.nextUrl.origin, // unused: redirect_uri is taken byte-exact from the signed state
      sessionTenant: admin.tenant,
    });
    return htmlResponse(
      postMessageHtml({ type: 'oauth-callback', provider: identity.provider, success: true, data: identity }),
      true,
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Connect failed.');
  }
}
