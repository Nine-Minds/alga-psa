import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { verifyRegisterUser } from '@alga-psa/auth/actions';
import VerifyEmailRedirect from './VerifyEmailRedirect';

export const dynamic = 'force-dynamic';

interface VerifyEmailPageProps {
  searchParams?: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const token = resolvedSearchParams?.token;
  const { t } = await getServerTranslation(undefined, 'msp/auth');

  // The verification runs on the server during render — equivalent to the
  // previous client effect, but with no loading flash and the result text is
  // server-rendered. A page refresh re-runs it, matching prior behaviour.
  let verificationSuccess = false;
  let verificationMessage = '';

  if (token) {
    try {
      const { message, wasSuccess } = await verifyRegisterUser(token);
      verificationSuccess = wasSuccess;
      verificationMessage = message;
    } catch {
      verificationSuccess = false;
      verificationMessage = t('verifyEmail.unknownErrorMessage', 'Unknow error verifying token');
    }
  }

  return (
    <div className="min-h-screen bg-[rgb(var(--color-background-50))] flex items-center justify-center">
      <div className="bg-card p-8 rounded-lg shadow-lg max-w-md text-center">
        {token ? (
          verificationSuccess ? (
            <>
              <h1 className="text-3xl font-bold text-[rgb(var(--color-primary-500))] mb-4">{t('verifyEmail.welcomeTitle', 'Welcome!')}</h1>
              <p className="text-[rgb(var(--color-text-700))] mb-6">
                {t('verifyEmail.welcomeMessage', 'Your email has been successfully verified. You will be redirected to the sign in page shortly.')}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-[rgb(var(--color-primary-500))] mb-4">{t('verifyEmail.processErrorTitle', 'Process Error!')}</h1>
              <p className="text-[rgb(var(--color-text-700))] mb-6">
                {verificationMessage}
              </p>
            </>
          )
        ) : (
          <>
            <h1 className="text-3xl font-bold text-[rgb(var(--color-primary-500))] mb-4">{t('verifyEmail.errorTitle', 'Error!')}</h1>
            <p className="text-[rgb(var(--color-text-700))] mb-6">
              {t('verifyEmail.tokenRequiredMessage', 'Verification process required a token. Please try again.')}
            </p>
          </>
        )}
        <VerifyEmailRedirect />
      </div>
    </div>
  );
}
