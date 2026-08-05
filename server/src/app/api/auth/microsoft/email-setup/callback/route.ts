import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  completeMicrosoftEmailApplicationCreation,
  getMicrosoftEmailSetupSigningSecret,
} from '@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions';
import { confirmMicrosoftEmailAdminConsentInternal } from '@alga-psa/integrations/actions/integrations/microsoftActions';
import { validateMicrosoftEmailSetupState } from '@alga-psa/integrations/lib/microsoftEmailSetup';
import { consumeMicrosoftEmailSetupState } from '@alga-psa/integrations/utils/microsoftEmailSetupStateStore';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const dynamic = 'force-dynamic';

// Stable failure codes for the setup popup's postMessage payload. The opener
// maps each code to a translated string; the English text here rides along as
// `error` so logs and any older opener still read sensibly, but it is never
// what the user sees.
const SETUP_FAILURES = {
  invalid_state: 'This Microsoft setup request is invalid or expired. Start again from Providers settings.',
  session_mismatch: 'Your Alga PSA session does not match the administrator who started this setup. Sign in and try again.',
  consent_denied: 'Microsoft sign-in or administrator consent was denied. Choose another setup option or try again.',
  microsoft_error: 'Microsoft could not complete the setup request. Try again or use manual setup.',
  consent_not_granted: 'Microsoft did not confirm tenant administrator consent.',
  consent_persist_failed: 'Failed to record Microsoft administrator consent.',
  missing_code: 'Microsoft did not return an authorization code. Start setup again.',
} as const;

type MicrosoftEmailSetupErrorCode = keyof typeof SETUP_FAILURES;

function failure(code: MicrosoftEmailSetupErrorCode, detail?: string) {
  return { success: false, errorCode: code, error: detail || SETUP_FAILURES[code] };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

async function respondToSetupWindow(input: {
  returnTo: string;
  payload: Record<string, unknown>;
}): Promise<NextResponse> {
  // The admin who started the setup is signed in, so the standard hierarchical
  // resolver (user preference → org default → Accept-Language) applies.
  const locale = await getServerLocale();
  const { t } = await getServerTranslation(locale, 'common');

  // Percent-encoded before base64 for the same reason as the copy below: the
  // payload can carry a Microsoft error message with accented characters, and
  // `atob` yields latin-1, so raw UTF-8 bytes would arrive mojibake'd.
  const encodedPayload = Buffer.from(encodeURIComponent(JSON.stringify({
    type: 'microsoft-email-setup-callback',
    ...input.payload,
  }))).toString('base64');
  const returnUrl = new URL(input.returnTo);
  const encodedReturnUrl = Buffer.from(returnUrl.toString()).toString('base64');
  // Script-side copy travels as base64 JSON like the payload above, so a
  // translation containing a quote or an angle bracket can never break out of
  // the inline script. Percent-encoded before base64 because `atob` yields a
  // latin-1 string — raw UTF-8 bytes would surface as mojibake for every
  // accented locale.
  const encodedText = Buffer.from(encodeURIComponent(JSON.stringify({
    finished: t('pages.microsoftEmailSetup.finished'),
    notFinished: t('pages.microsoftEmailSetup.notFinished'),
    returnLink: t('pages.microsoftEmailSetup.returnLink'),
  }))).toString('base64');
  const targetOrigin = returnUrl.origin;
  const html = `<!doctype html>
<html lang="${locale}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(t('pages.microsoftEmailSetup.title'))}</title></head>
  <body>
    <p id="status">${escapeHtml(t('pages.microsoftEmailSetup.finishing'))}</p>
    <script>
      (function () {
        var payload = JSON.parse(decodeURIComponent(atob('${encodedPayload}')));
        var text = JSON.parse(decodeURIComponent(atob('${encodedText}')));
        var target = window.opener || window.parent;
        if (target && target !== window) target.postMessage(payload, '${targetOrigin}');
        try { window.close(); } catch (_) {}
        setTimeout(function () {
          if (!window.closed) {
            document.getElementById('status').textContent = payload.success
              ? text.finished
              : text.notFinished;
            var link = document.createElement('a');
            link.href = atob('${encodedReturnUrl}');
            link.textContent = text.returnLink;
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

function genericFailure(code: MicrosoftEmailSetupErrorCode): Promise<NextResponse> {
  return respondToSetupWindow({
    returnTo: `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'}/msp/settings/integrations?category=providers`,
    payload: failure(code),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const stateToken = request.nextUrl.searchParams.get('state');
  const signingSecret = await getMicrosoftEmailSetupSigningSecret();
  const state = validateMicrosoftEmailSetupState({ token: stateToken, secret: signingSecret });
  if (!state) {
    return genericFailure('invalid_state');
  }

  const user = await getCurrentUser();
  if (!user?.tenant || user.tenant !== state.algaTenant || user.user_id !== state.userId) {
    if (state.purpose === 'create_application') {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    }
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: failure('session_mismatch'),
    });
  }

  const microsoftError = request.nextUrl.searchParams.get('error');
  if (microsoftError) {
    if (state.purpose === 'create_application') {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    }
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: failure(microsoftError === 'access_denied' ? 'consent_denied' : 'microsoft_error'),
    });
  }

  if (state.purpose === 'admin_consent') {
    const granted = request.nextUrl.searchParams.get('admin_consent')?.toLowerCase() === 'true';
    const microsoftTenant = request.nextUrl.searchParams.get('tenant') || undefined;
    if (!granted) {
      return respondToSetupWindow({
        returnTo: state.returnTo,
        payload: failure('consent_not_granted'),
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
        : failure('consent_persist_failed', persisted.error),
    });
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: failure('missing_code'),
    });
  }

  const result = await completeMicrosoftEmailApplicationCreation({ user, state, code });
  return respondToSetupWindow({
    returnTo: state.returnTo,
    payload: { ...result },
  });
}
