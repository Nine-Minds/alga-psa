import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export default async function VerifyPage() {
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight">
            {t('auth.verify.title', { defaultValue: 'Email Verification No Longer Available' })}
          </h2>
          <p className="mt-2 text-center text-gray-600">
            {t('auth.verify.selfRegistrationRemoved', {
              defaultValue:
                'Self-registration via email domain is no longer supported for security reasons.',
            })}
          </p>
          <p className="mt-4 text-center text-gray-600">
            {t('auth.verify.existingContactsOnly', {
              defaultValue:
                'Registration is now only available for existing contacts. Please contact your administrator to be added as a contact first.',
            })}
          </p>
        </div>
        <Alert>
          <AlertDescription>
            {t('auth.verify.registerFromSignIn', {
              defaultValue:
                'If you are an existing contact, you can register directly from the sign-in page using your contact email address.',
            })}
          </AlertDescription>
        </Alert>
        <div className="text-center">
          <Link href="/auth/msp/signin">
            <Button
              id="return-to-signin-button"
              variant="outline"
              className="mt-4"
            >
              {t('auth.verify.returnToSignIn', { defaultValue: 'Return to Sign In' })}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
