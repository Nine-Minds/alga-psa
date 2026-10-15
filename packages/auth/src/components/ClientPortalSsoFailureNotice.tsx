"use client";

import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { oauthMappingFailureFallbackMessage, parseOAuthMappingFailureCode } from '../lib/sso/types';

/**
 * Inline sign-in failure notice for the client portal pages that have no tenant
 * to render the branded sign-in form against. The tenant-discovery form shows no
 * error of its own, so an SSO mapping failure redirected there would otherwise
 * vanish and leave the visitor with no idea why sign-in did not take.
 */
export default function ClientPortalSsoFailureNotice() {
  const { t } = useTranslation('client-portal');
  const searchParams = useSearchParams();

  const error = searchParams?.get('error');
  const reason = parseOAuthMappingFailureCode(searchParams?.get('reason'));
  const providerEmail = searchParams?.get('providerEmail') ?? '';

  if (error !== 'AccessDenied' && error !== 'Configuration') {
    return null;
  }

  const title =
    error === 'Configuration'
      ? t('auth.configurationTitle', 'Sign-in failed')
      : reason
        ? t('auth.ssoNoMatchTitle', 'SSO sign-in failed')
        : t('auth.accessDeniedTitle', 'Access Denied');

  const message =
    error === 'Configuration'
      ? t('auth.configurationMessage', 'Sign-in failed. Please try again or contact your service provider.')
      : reason
        ? t(`auth.ssoNoMatch.${reason}`, {
            providerEmail,
            defaultValue: oauthMappingFailureFallbackMessage(reason, 'client', providerEmail),
          })
        : t('auth.accessDeniedMessage', 'You do not have permission to access the client portal.');

  return (
    <div
      id="client-portal-sso-failure-notice"
      role="alert"
      className="max-w-md w-full mx-auto mb-4 rounded-lg border border-error bg-error/10 p-4 flex gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-error shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-[rgb(var(--color-text-600))] break-words">{message}</p>
      </div>
    </div>
  );
}
