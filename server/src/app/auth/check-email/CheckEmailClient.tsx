"use client";

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { appendPortalDomain } from '@alga-psa/auth/client';
import { recoverPassword } from '@alga-psa/auth/actions';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TenantBranding } from '@alga-psa/tenancy/actions';

interface CheckEmailClientProps {
  branding: TenantBranding | null;
  portalDomain?: string;
}

const CheckEmailClient: React.FC<CheckEmailClientProps> = ({ branding, portalDomain }) => {
  const [isResending, setIsResending] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email');
  const portal = searchParams.get('portal') || 'msp'; // Default to MSP if not specified
  const { t } = useTranslation();

  const handleResend = async () => {
    if (!email) return;

    setIsResending(true);
    try {
      await recoverPassword(email, portal as 'msp' | 'client', portal === 'client' ? portalDomain : undefined);
      toast.success(t('auth.checkEmail.resendSuccess', 'Email sent! Please check your inbox.'));
    } catch {
      toast.error(t('auth.checkEmail.resendFailed', 'Failed to resend email. Please try again.'));
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToSignIn = () => {
    const signinHref = portal === 'client' ? '/auth/client-portal/signin' : '/auth/msp/signin';
    router.push(portal === 'client' ? appendPortalDomain(signinHref, portalDomain) : signinHref);
  };

  const bgGradient = branding && portal === 'client'
    ? 'bg-gradient-to-br from-[rgb(var(--color-primary-50))] to-[rgb(var(--color-secondary-100))] dark:from-[rgb(var(--color-primary-950))] dark:to-[rgb(var(--color-secondary-950))]'
    : portal === 'client'
    ? 'bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950 dark:to-indigo-950'
    : 'bg-gradient-to-br from-purple-50 via-purple-100 to-indigo-100 dark:from-purple-950 dark:via-purple-950/80 dark:to-indigo-950';

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${bgGradient}`}>
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg p-8">
          {branding?.logoUrl && (
            <img
              src={branding.logoUrl}
              alt={branding.clientName || t('auth.checkEmail.logoAlt', 'Client logo')}
              width={60}
              height={60}
              className="mx-auto mb-6 h-[60px] w-[60px] rounded-full object-contain"
            />
          )}

          {/* Title */}
          <h2 className="text-2xl font-bold text-[rgb(var(--color-text-900))] text-center mb-2 flex items-center justify-center gap-2">
            <Mail className="w-6 h-6" />
            Check Your Email
          </h2>
          <p className="text-[rgb(var(--color-text-600))] text-center mb-6">
            We've sent you a password reset link
          </p>

          {/* Info Box */}
          <div className="mb-6">
            <Alert>
              <AlertDescription>
                If an account exists with the email address <strong>{email}</strong>,
                you will receive a password reset link shortly.
              </AlertDescription>
            </Alert>
          </div>

          {/* What's next section */}
          <div className="mb-6">
            <div className="p-4 bg-[rgb(var(--color-primary-50))] rounded-lg">
              <h4 className="font-medium text-sm mb-2 text-[rgb(var(--color-primary-900))]">{t('auth.checkEmail.whatsNext')}</h4>
              <ol className="text-sm text-[rgb(var(--color-primary-700))] space-y-1">
                <li>1. Check your email inbox</li>
                <li>2. Click the reset link in the email</li>
                <li>3. Set your new password</li>
              </ol>
            </div>
          </div>

          {/* Didn't receive section */}
          <div className="mb-6">
            <Alert variant="info">
              <AlertDescription>
                <h4 className="font-medium text-sm mb-2">{t('auth.checkEmail.didntReceive')}</h4>
                <ul className="text-sm space-y-1">
                  <li>• Check your spam or junk folder</li>
                  <li>• Make sure you entered the correct email</li>
                  <li>• The link expires in 1 hour</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Buttons */}
          <div className="space-y-3">
            <Button
              id="send-reset-link-button"
              onClick={handleResend}
              disabled={isResending}
              className="w-full"
            >
              {isResending ? 'Sending...' : 'Request Another Link'}
            </Button>

            <Button
              id="back-to-signin-button-footer"
              variant="outline"
              onClick={handleBackToSignIn}
              className="w-full"
            >
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckEmailClient;
