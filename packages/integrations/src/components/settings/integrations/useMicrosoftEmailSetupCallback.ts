'use client';

import React from 'react';

export const MICROSOFT_EMAIL_SETUP_CALLBACK_MESSAGE = 'microsoft-email-setup-callback';

export interface MicrosoftEmailSetupCallbackResult {
  type?: string;
  success?: boolean;
  stage?: string;
  errorCode?: string;
  error?: string;
  aadsts?: string;
  correlationId?: string;
  microsoftDetail?: string;
  [key: string]: unknown;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

// The setup callback route reports failures as stable codes (never prose), so
// the popup's English payload never reaches the user. Keys live in
// msp/integrations alongside the rest of the Microsoft mailbox setup copy.
export const CALLBACK_ERROR_TEXT: Record<string, { key: string; defaultValue: string }> = {
  invalid_state: {
    key: 'integrations.microsoft.emailSetup.errors.invalidState',
    defaultValue: 'This Microsoft setup request is invalid or expired. Start again from Providers settings.',
  },
  session_mismatch: {
    key: 'integrations.microsoft.emailSetup.errors.sessionMismatch',
    defaultValue: 'This setup was started in a different browser or a private window. Finish it in the same window you started it in, or use the approval link.',
  },
  consent_denied: {
    key: 'integrations.microsoft.emailSetup.errors.consentDenied',
    defaultValue: 'Microsoft sign-in or administrator consent was denied. Choose another setup option or try again.',
  },
  policy_blocked: {
    key: 'integrations.microsoft.emailSetup.errors.policyBlocked',
    defaultValue: 'A Conditional Access or device policy in your Microsoft tenant blocked the sign-in. Ask your Microsoft admin to exempt this app, or approve from a device your policy allows.',
  },
  admin_required: {
    key: 'integrations.microsoft.emailSetup.errors.adminRequired',
    defaultValue: 'This needs a Microsoft Global Administrator to approve the app. Copy the approval link and send it to them.',
  },
  wrong_tenant: {
    key: 'integrations.microsoft.emailSetup.errors.wrongTenant',
    defaultValue: 'The Microsoft account used belongs to a different Microsoft tenant than the one being configured.',
  },
  app_not_found: {
    key: 'integrations.microsoft.emailSetup.errors.appNotFound',
    defaultValue: 'The Microsoft app could not be found in that Microsoft tenant. It may have been deleted or the Microsoft tenant is wrong. You can set up a different app manually.',
  },
  microsoft_error: {
    key: 'integrations.microsoft.emailSetup.errors.microsoftError',
    defaultValue: 'Microsoft could not complete the setup request.',
  },
  consent_not_granted: {
    key: 'integrations.microsoft.emailSetup.errors.consentNotGranted',
    defaultValue: 'Microsoft did not confirm tenant administrator consent.',
  },
  consent_persist_failed: {
    key: 'integrations.microsoft.emailSetup.errors.consentPersistFailed',
    defaultValue: 'Failed to record Microsoft administrator consent.',
  },
  missing_code: {
    key: 'integrations.microsoft.emailSetup.errors.missingCode',
    defaultValue: 'Microsoft did not return an authorization code. Start setup again.',
  },
};

/**
 * Translated failure text for a callback result: the mapped message, then
 * Microsoft's own reason for unmapped errors, then the diagnostics to quote
 * when checking Entra sign-in logs.
 */
export function formatMicrosoftEmailSetupFailure(
  t: Translate,
  data: Pick<MicrosoftEmailSetupCallbackResult, 'errorCode' | 'error' | 'aadsts' | 'correlationId' | 'microsoftDetail'>,
): string {
  const mapped = data.errorCode ? CALLBACK_ERROR_TEXT[data.errorCode] : undefined;
  const parts: string[] = [
    mapped
      ? t(mapped.key, { defaultValue: mapped.defaultValue })
      // Provisioning failures still arrive as a server-composed message.
      : data.error || t('integrations.microsoft.emailSetup.errors.generic', { defaultValue: 'Microsoft Email setup did not complete.' }),
  ];
  if (data.errorCode === 'microsoft_error' && data.microsoftDetail) {
    parts.push(data.microsoftDetail);
  }
  const diagnostics = [data.aadsts ? `AADSTS${data.aadsts}` : null, data.correlationId || null].filter(Boolean);
  if (diagnostics.length > 0) {
    parts.push(t('integrations.microsoft.emailSetup.errors.quoteDiagnostics', {
      defaultValue: 'Quote this when checking Entra sign-in logs: {{diagnostics}}',
      diagnostics: diagnostics.join(' · '),
    }));
  }
  return parts.join(' ');
}

/**
 * Subscribes to the setup popup's `postMessage` outcome (same origin only).
 */
export function useMicrosoftEmailSetupCallback(
  onResult: (result: MicrosoftEmailSetupCallbackResult) => void,
  enabled = true,
): void {
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;

  React.useEffect(() => {
    if (!enabled) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== MICROSOFT_EMAIL_SETUP_CALLBACK_MESSAGE) {
        return;
      }
      onResultRef.current(event.data as MicrosoftEmailSetupCallbackResult);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled]);
}
