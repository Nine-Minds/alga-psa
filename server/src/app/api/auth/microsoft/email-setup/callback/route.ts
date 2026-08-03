import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  completeMicrosoftEmailApplicationCreation,
  getMicrosoftEmailSetupSigningSecret,
} from '@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions';
import { confirmMicrosoftEmailAdminConsentInternal } from '@alga-psa/integrations/actions/integrations/microsoftActions';
import { validateMicrosoftEmailSetupState } from '@alga-psa/integrations/lib/microsoftEmailSetup';
import { consumeMicrosoftEmailSetupState } from '@alga-psa/integrations/utils/microsoftEmailSetupStateStore';

export const dynamic = 'force-dynamic';

function respondToSetupWindow(input: {
  returnTo: string;
  payload: Record<string, unknown>;
}): NextResponse {
  const encodedPayload = Buffer.from(JSON.stringify({
    type: 'microsoft-email-setup-callback',
    ...input.payload,
  })).toString('base64');
  const returnUrl = new URL(input.returnTo);
  const encodedReturnUrl = Buffer.from(returnUrl.toString()).toString('base64');
  const targetOrigin = returnUrl.origin;
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Microsoft Email Setup</title></head>
  <body>
    <p id="status">Finishing Microsoft Email setup…</p>
    <script>
      (function () {
        var payload = JSON.parse(atob('${encodedPayload}'));
        var target = window.opener || window.parent;
        if (target && target !== window) target.postMessage(payload, '${targetOrigin}');
        try { window.close(); } catch (_) {}
        setTimeout(function () {
          if (!window.closed) {
            document.getElementById('status').textContent = payload.success
              ? 'Setup finished. You can close this window.'
              : 'Setup did not finish. Return to Alga PSA to review the error.';
            var link = document.createElement('a');
            link.href = atob('${encodedReturnUrl}');
            link.textContent = 'Return to Alga PSA';
            document.body.appendChild(link);
          }
        }, 150);
      })();
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

function genericFailure(error: string): NextResponse {
  return respondToSetupWindow({
    returnTo: `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'}/msp/settings/integrations?category=providers`,
    payload: { success: false, error },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const stateToken = request.nextUrl.searchParams.get('state');
  const signingSecret = await getMicrosoftEmailSetupSigningSecret();
  const state = validateMicrosoftEmailSetupState({ token: stateToken, secret: signingSecret });
  if (!state) {
    return genericFailure('This Microsoft setup request is invalid or expired. Start again from Providers settings.');
  }

  const user = await getCurrentUser();
  if (!user?.tenant || user.tenant !== state.algaTenant || user.user_id !== state.userId) {
    if (state.purpose === 'create_application') {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    }
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: {
        success: false,
        error: 'Your Alga PSA session does not match the administrator who started this setup. Sign in and try again.',
      },
    });
  }

  const microsoftError = request.nextUrl.searchParams.get('error');
  if (microsoftError) {
    if (state.purpose === 'create_application') {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    }
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: {
        success: false,
        error: microsoftError === 'access_denied'
          ? 'Microsoft sign-in or administrator consent was denied. Choose another setup option or try again.'
          : 'Microsoft could not complete the setup request. Try again or use manual setup.',
      },
    });
  }

  if (state.purpose === 'admin_consent') {
    const granted = request.nextUrl.searchParams.get('admin_consent')?.toLowerCase() === 'true';
    const microsoftTenant = request.nextUrl.searchParams.get('tenant') || undefined;
    if (!granted) {
      return respondToSetupWindow({
        returnTo: state.returnTo,
        payload: { success: false, error: 'Microsoft did not confirm tenant administrator consent.' },
      });
    }

    const persisted = await confirmMicrosoftEmailAdminConsentInternal(user, state.algaTenant, {
      profileId: state.profileId!,
      clientId: state.clientId!,
      microsoftTenantId: microsoftTenant,
    });
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: persisted.success
        ? { success: true, stage: 'admin_consent', tenantId: microsoftTenant, clientId: state.clientId, profileId: state.profileId }
        : { success: false, error: persisted.error || 'Failed to record Microsoft administrator consent.' },
    });
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: { success: false, error: 'Microsoft did not return an authorization code. Start setup again.' },
    });
  }

  const result = await completeMicrosoftEmailApplicationCreation({ user, state, code });
  return respondToSetupWindow({
    returnTo: state.returnTo,
    payload: { ...result },
  });
}
