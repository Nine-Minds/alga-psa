"use client";
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { Label, Input, Button, Alert, AlertDescription, AlertTitle, Checkbox } from '@alga-psa/ui/components';
import type { AlertProps } from '@alga-psa/types';
import { useRegisterUIComponent, withDataAutomationId } from '@alga-psa/ui/ui-reflection';
import type { FormComponent, FormFieldComponent } from '@alga-psa/ui/ui-reflection';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import SsoProviderButtons from '@alga-psa/auth/sso/entry';
import CaptchaChallenge from './CaptchaChallenge';
import { useLoginCaptcha } from './useLoginCaptcha';

/**
 * Server action that emails the user one sign-in link per organization. Injected
 * by the app (it needs @alga-psa/tenancy and @alga-psa/email, which depend on
 * this package), so this component never imports the concrete action.
 */
export type RequestSignInLinks = (
  email: string,
  callbackUrl?: string,
) => Promise<{ success: boolean; message?: string; error?: string }>;

interface MspLoginFormProps {
  requestSignInLinks: RequestSignInLinks;
  callbackUrl: string;
  initialEmail?: string;
  /** Validated organization slug from `?tenant=`; scopes password and SSO sign-in. */
  tenantSlug?: string;
  /** Open with the "email me sign-in links" offer (SSO `tenant_required` hand-off). */
  initialTenantRequired?: boolean;
  onError: (alertInfo: AlertProps) => void;
  onTwoFactorRequired: () => void;
}

export default function MspLoginForm({
  requestSignInLinks,
  callbackUrl,
  initialEmail,
  tenantSlug,
  initialTenantRequired = false,
  onError,
  onTwoFactorRequired,
}: MspLoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState(() => initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [isPublicWorkstation, setIsPublicWorkstation] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tenantRequired, setTenantRequired] = useState(initialTenantRequired);
  const [linksRequested, setLinksRequested] = useState(false);
  const [isSendingLinks, setIsSendingLinks] = useState(false);
  const captcha = useLoginCaptcha();
  const { t } = useTranslation('msp/auth', { useSuspense: false });

  useEffect(() => {
    setEmail(initialEmail ?? '');
  }, [initialEmail]);

  // Register the form component
  const updateForm = useRegisterUIComponent<FormComponent>({
    id: 'msp-login-form',
    type: 'form',
    label: 'MSP Login'
  });

  const persistRememberedEmail = async () => {
    try {
      await fetch('/api/auth/msp/remember-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          publicWorkstation: isPublicWorkstation,
        }),
      });
    } catch {
      // Remembered-email persistence is best-effort and must not block sign-in.
    }
  };

  const handleSendOrgLinks = async () => {
    setIsSendingLinks(true);
    try {
      await requestSignInLinks(email, callbackUrl);
    } catch {
      // The confirmation is deliberately identical whatever happened.
    } finally {
      setLinksRequested(true);
      setIsSendingLinks(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setIsSubmitting(true);

    try {
      const result = (await signIn('credentials', {
        email,
        password,
        userType: 'internal',
        ...(tenantSlug ? { tenant: tenantSlug } : {}),
        redirect: false,
        callbackUrl,
        ...(captcha.token ? { captchaToken: captcha.token } : {}),
      })) as unknown as { error?: string; code?: string; url?: string } | undefined;

      if (result?.error === '2FA_REQUIRED') {
        onTwoFactorRequired();
      } else if (result?.code === 'CAPTCHA_REQUIRED') {
        await captcha.requireCaptcha();
        setLookupError(t('signIn.errors.captchaRequired', 'Please complete the verification below, then sign in again.'));
      } else if (result?.code === 'RATE_LIMITED') {
        onError({
          type: 'error',
          title: t('signIn.errors.rateLimitedTitle', 'Too Many Attempts'),
          message: t('signIn.errors.rateLimitedMessage', 'Too many failed sign-in attempts. Please wait a few minutes before trying again.')
        });
      } else if (result?.code === 'TENANT_REQUIRED') {
        // The credentials were right, but the email belongs to internal users in
        // more than one organization. Offer to email one scoped sign-in link per
        // organization. Not a failed attempt, so leave the captcha alone.
        setTenantRequired(true);
        setLinksRequested(false);
      } else if (result?.error) {
        if (captcha.required) {
          captcha.refreshChallenge();
        }
        onError({
          type: 'error',
          title: t('signIn.errors.failedTitle', 'Sign-in Failed'),
          message: t('signIn.errors.failedMessage', 'Invalid email or password. Please try again.')
        });
      } else if (result?.url) {
        await persistRememberedEmail();
        window.location.href = result.url;
      }
    } catch (error) {
      onError({
        type: 'error',
        title: t('signIn.alerts.errorTitle', 'Error'),
        message: t('signIn.errors.unexpectedMessage', 'An unexpected error occurred. Please try again.')
      });
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <form 
      className="mt-8 space-y-6" 
      onSubmit={handleSubmit}
      method="POST"
      {...withDataAutomationId({ id: 'msp-login-form' })}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="msp-email-field">{t('signIn.form.emailLabel', 'Email')}</Label>
          <Input
            type="email"
            id="msp-email-field"
            name="email"
            placeholder={t('signIn.form.emailPlaceholder', 'Enter your email')}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // The offer is about the previous address.
              setTenantRequired(false);
              setLinksRequested(false);
            }}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2 relative">
          <Label htmlFor="msp-password-field">{t('signIn.form.passwordLabel', 'Password')}</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              id="msp-password-field"
              name="password"
              placeholder={t('signIn.form.passwordPlaceholder', 'Password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
              autoComplete="current-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute inset-y-0 right-0 pr-3 flex items-center hover:bg-transparent"
              onClick={() => setShowPassword(!showPassword)}
              id="msp-toggle-password-visibility"
            >
              {showPassword ? (
                <Eye className="h-5 w-5 text-[rgb(var(--color-text-400))]" />
              ) : (
                <EyeOff className="h-5 w-5 text-[rgb(var(--color-text-400))]" />
              )}
            </Button>
          </div>
        </div>
        <Checkbox
          id="msp-public-workstation-checkbox"
          checked={isPublicWorkstation}
          label={t('signIn.form.publicWorkstation', 'Public workstation - do not remember my email')}
          onChange={(event) => setIsPublicWorkstation(event.target.checked)}
        />
      </div>

      {lookupError && (
        <Alert variant="destructive">
          <AlertDescription>{lookupError}</AlertDescription>
        </Alert>
      )}

      {tenantRequired && (
        <Alert variant="info" id="msp-tenant-required-alert">
          <AlertTitle>{t('signIn.tenantRequired.title', 'Choose your organization')}</AlertTitle>
          <AlertDescription>
            <p>
              {t(
                'signIn.tenantRequired.message',
                'This email is used in more than one organization. We can email you a sign-in link for each one.'
              )}
            </p>
            {linksRequested ? (
              <p className="mt-2" id="msp-send-org-links-confirmation" role="status">
                {t(
                  'signIn.tenantRequired.sent',
                  'If an account exists with that email, sign-in links have been sent.'
                )}
              </p>
            ) : null}
            <Button
              type="button"
              id="msp-send-org-links-button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={linksRequested || isSendingLinks || !email}
              onClick={handleSendOrgLinks}
            >
              {t('signIn.tenantRequired.button', 'Email me my sign-in links')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {captcha.required && captcha.config?.siteKey && (
        <CaptchaChallenge
          siteKey={captcha.config.siteKey}
          onToken={captcha.setToken}
          resetSignal={captcha.resetSignal}
          id="msp-login-captcha"
        />
      )}

        <div className="text-sm text-right space-y-1">
          <div>
            <Link href="/auth/msp/forgot-password"
            className="font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-400))]"
            {...withDataAutomationId({ id: 'msp-forgot-password-link' })}>
              {t('signIn.form.forgotPassword', 'Forgot your password?')}
            </Link>
          </div>
          <div className="text-[rgb(var(--color-text-600))]">
            {t('signIn.form.noAccount', "Don't have an account?")}{' '}
            <a
              href="https://www.nineminds.com/plans"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-400))]"
            >
              {t('signIn.form.signUp', 'Sign up')}
            </a>
          </div>
        </div>

      <div>
        <Button
          type="submit"
          className="w-full"
          id="msp-sign-in-button"
          disabled={isSubmitting || (captcha.required && !!captcha.config?.siteKey && !captcha.token)}
        >
          {t('signIn.form.submit', 'Sign in')}
        </Button>
      </div>

     <SsoProviderButtons
       callbackUrl={callbackUrl}
       email={email}
       publicWorkstation={isPublicWorkstation}
       tenantHint={tenantSlug}
       onError={(message) => setLookupError(message || null)}
     />

    </form>
  );
}
