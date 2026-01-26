'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

export default function VerifyPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Email Verification No Longer Available
          </h2>
          <p className="mt-2 text-center text-gray-600">
            Self-registration via email domain is no longer supported for security reasons.
          </p>
          <p className="mt-4 text-center text-gray-600">
            Registration is now only available for existing contacts. Please contact your administrator to be added as a contact first.
          </p>
        </div>
        <Alert>
          <AlertDescription>
            If you are an existing contact, you can register directly from the sign-in page using your contact email address.
          </AlertDescription>
        </Alert>
        <div className="text-center">
          <Button
            id="return-to-signin-button"
            variant="outline"
            onClick={() => router.push('/auth/msp/signin')}
            className="mt-4"
          >
            Return to Sign In
          </Button>
        </div>
      </div>
    </div>
  );
}