import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { PROVIDER_SETUP_ENTRY_PATH } from '@alga-psa/types';
import {
  completeMicrosoftEmailApplicationCreation,
  getMicrosoftEmailSetupSigningSecret,
} from '@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions';
// Only this route may import the unguarded, state-authorised consent writer.
import { recordMicrosoftEmailAdminConsentFromState } from '@alga-psa/integrations/lib/microsoftEmailAdminConsent';
import { describeMicrosoftSetupError } from '@alga-psa/integrations/lib/microsoftEmailSetupError';
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
  session_mismatch: 'This setup was started in a different browser or a private window. Finish it in the same window you started it in, or use the approval link.',
  consent_denied: 'Microsoft sign-in or administrator consent was denied. Choose another setup option or try again.',
  policy_blocked: 'A Conditional Access or device policy in your Microsoft tenant blocked the sign-in. Ask your Microsoft admin to exempt this app, or approve from a device your policy allows.',
  admin_required: 'This needs a Microsoft Global Administrator to approve the app. Copy the approval link and send it to them.',
  wrong_tenant: 'The Microsoft account used belongs to a different Microsoft tenant than the one being configured.',
  app_not_found: 'The Microsoft app could not be found in that Microsoft tenant. It may have been deleted or the Microsoft tenant is wrong. You can set up a different app manually.',
  microsoft_error: 'Microsoft could not complete the setup request.',
  consent_not_granted: 'Microsoft did not confirm administrator consent.',
  consent_persist_failed: 'Failed to record Microsoft administrator consent.',
  missing_code: 'Microsoft did not return an authorization code. Start setup again.',
} as const;

type MicrosoftEmailSetupErrorCode = keyof typeof SETUP_FAILURES;

function failure(
  code: MicrosoftEmailSetupErrorCode,
  detail?: string,
  diagnostics?: { aadsts?: string | null; correlationId?: string | null; detail?: string | null },
) {
  return {
    success: false,
    errorCode: code,
    error: detail || SETUP_FAILURES[code],
    ...(diagnostics?.aadsts ? { aadsts: diagnostics.aadsts } : {}),
    ...(diagnostics?.correlationId ? { correlationId: diagnostics.correlationId } : {}),
    ...(diagnostics?.detail ? { microsoftDetail: diagnostics.detail } : {}),
  };
}

// One structured line per callback. Never include the state token, the
// authorization code or Microsoft's raw error_description.
function logCallback(entry: {
  purpose: string;
  outcome: 'success' | 'failure';
  errorCode?: string | null;
  aadsts?: string | null;
  correlationId?: string | null;
  algaTenant?: string | null;
  profileId?: string | null;
}) {
  const line = {
    purpose: entry.purpose,
    outcome: entry.outcome,
    errorCode: entry.errorCode ?? null,
    aadsts: entry.aadsts ?? null,
    correlationId: entry.correlationId ?? null,
    algaTenant: entry.algaTenant ?? null,
    profileId: entry.profileId ?? null,
  };
  if (entry.outcome === 'success') console.info('[microsoft-email-setup] callback', line);
  else console.warn('[microsoft-email-setup] callback', line);
}

// Used when there is no window.opener (full-page approval, or the copied link
// opened in a fresh tab). `returnTo` always comes from the signed state.
function buildNoOpenerRedirectUrl(returnTo: string, payload: Record<string, unknown>): string {
  const url = new URL(returnTo);
  url.searchParams.set('microsoft_email_setup', payload.success ? 'ok' : 'error');
  if (!payload.success) {
    if (typeof payload.errorCode === 'string') url.searchParams.set('error_code', payload.errorCode);
    if (typeof payload.aadsts === 'string') url.searchParams.set('aadsts', payload.aadsts);
    if (typeof payload.correlationId === 'string') url.searchParams.set('correlation_id', payload.correlationId);
  }
  return url.toString();
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
  const encodedRedirectUrl = Buffer.from(buildNoOpenerRedirectUrl(input.returnTo, input.payload)).toString('base64');
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
        if (!window.opener) {
          // No popup to report to: hand the outcome to the Providers page.
          window.location.replace(atob('${encodedRedirectUrl}'));
          return;
        }
        window.opener.postMessage(payload, '${targetOrigin}');
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
    returnTo: `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'}${PROVIDER_SETUP_ENTRY_PATH}`,
    payload: failure(code),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const stateToken = request.nextUrl.searchParams.get('state');
  const signingSecret = await getMicrosoftEmailSetupSigningSecret();
  const state = validateMicrosoftEmailSetupState({ token: stateToken, secret: signingSecret });
  if (!state) {
    logCallback({ purpose: 'unknown', outcome: 'failure', errorCode: 'invalid_state' });
    return genericFailure('invalid_state');
  }

  const log = (outcome: 'success' | 'failure', extra: { errorCode?: string; aadsts?: string | null; correlationId?: string | null } = {}) =>
    logCallback({ purpose: state.purpose, outcome, algaTenant: state.algaTenant, profileId: state.profileId, ...extra });

  // admin_consent is authorised by the signed, unexpired, purpose-scoped state
  // plus Microsoft's admin_consent=True: the approval link is meant to be opened
  // by a different admin who has no Alga session. create_application still
  // requires the admin who started it.
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  if (state.purpose === 'create_application') {
    user = await getCurrentUser();
    if (!user?.tenant || user.tenant !== state.algaTenant || user.user_id !== state.userId) {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
      log('failure', { errorCode: 'session_mismatch' });
      return respondToSetupWindow({
        returnTo: state.returnTo,
        payload: failure('session_mismatch'),
      });
    }
  }

  const microsoftError = request.nextUrl.searchParams.get('error');
  if (microsoftError) {
    if (state.purpose === 'create_application') {
      await consumeMicrosoftEmailSetupState(state.nonce).catch(() => null);
    }
    const described = describeMicrosoftSetupError({
      error: microsoftError,
      error_description: request.nextUrl.searchParams.get('error_description'),
      error_codes: request.nextUrl.searchParams.get('error_codes'),
      correlation_id: request.nextUrl.searchParams.get('correlation_id'),
      redact: [stateToken, request.nextUrl.searchParams.get('code')],
    });
    log('failure', described);
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: failure(described.errorCode, undefined, described),
    });
  }

  if (state.purpose === 'admin_consent') {
    const granted = request.nextUrl.searchParams.get('admin_consent')?.toLowerCase() === 'true';
    const microsoftTenant = request.nextUrl.searchParams.get('tenant') || undefined;
    if (!granted) {
      log('failure', { errorCode: 'consent_not_granted' });
      return respondToSetupWindow({
        returnTo: state.returnTo,
        payload: failure('consent_not_granted'),
      });
    }

    const persisted = await recordMicrosoftEmailAdminConsentFromState({
      algaTenant: state.algaTenant,
      clientId: state.clientId!,
      profileId: state.profileId!,
      microsoftTenantId: microsoftTenant,
    });
    log(persisted.success ? 'success' : 'failure', persisted.success ? {} : { errorCode: 'consent_persist_failed' });
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
    log('failure', { errorCode: 'missing_code' });
    return respondToSetupWindow({
      returnTo: state.returnTo,
      payload: failure('missing_code'),
    });
  }

  const result = await completeMicrosoftEmailApplicationCreation({ user: user!, state, code });
  log(result.success ? 'success' : 'failure', result.success ? {} : { errorCode: (result as any).errorCode });
  return respondToSetupWindow({
    returnTo: state.returnTo,
    payload: { ...result },
  });
}
