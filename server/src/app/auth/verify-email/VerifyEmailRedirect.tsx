'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const REDIRECT_SECONDS = 5;
const SIGNIN_HREF = '/auth/msp/signin';

/**
 * The only interactive part of the verify-email route: a countdown that
 * redirects to the sign-in page and a manual "Go to sign in" button. Kept as a
 * client component so the surrounding verification status can render on the
 * server.
 */
export default function VerifyEmailRedirect() {
  const { t } = useTranslation('msp/auth');
  const router = useRouter();
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (countdown <= 0) {
      router.push(SIGNIN_HREF);
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown, router]);

  return (
    <>
      <p className="text-[rgb(var(--color-text-500))] mb-4">
        {t('verifyEmail.redirecting', 'Redirecting in {{count}} seconds...', { count: countdown })}
      </p>
      <button
        onClick={() => router.push(SIGNIN_HREF)}
        className="mt-4 px-4 py-2 bg-[rgb(var(--color-primary-600))] text-white rounded-md shadow hover:bg-[rgb(var(--color-primary-700))] transition"
      >
        {t('verifyEmail.goToSignIn', 'Go to Sign In')}
      </button>
    </>
  );
}
