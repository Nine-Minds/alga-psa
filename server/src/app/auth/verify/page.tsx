'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { verifyRegistrationToken, completeRegistration } from 'server/src/lib/actions/user-actions/registrationActions';

export default function VerifyPage() {
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || null;
  const registrationId = searchParams?.get('registrationId') || null;

  useEffect(() => {
    if (token) {
      verifyToken();
    } else {
      setIsLoading(false);
    }
  }, [token]);

  async function verifyToken() {
    try {
      const result = await verifyRegistrationToken(token!);
      if (result.success) {
        setIsVerified(true);
        // Complete the registration
        const completion = await completeRegistration(result.registrationId!);
        if (completion.success) {
          router.push('/auth/signin?registered=true&callbackUrl=/client-portal/dashboard');
        } else {
          setError(completion.error || 'Failed to complete registration');
        }
      } else {
        setError(result.error || 'Invalid or expired verification token');
      }
    } catch (error) {
      setError('An unexpected error occurred during verification');
      console.error('Verification error:', error);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 text-center">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Verifying your email...
          </h2>
          <p className="text-gray-500">Please wait while we verify your email address.</p>
        </div>
      </div>
    );
  }

  if (!token && registrationId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div>
            <h2 className="text-center text-3xl font-bold tracking-tight">
              Check your email
            </h2>
            <p className="mt-2 text-center text-gray-600">
              We&apos;ve sent a verification link to your email address. Click the link to complete your registration.
            </p>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="text-center">
            <Button
              id="return-to-signin-button"
              variant="outline"
              onClick={() => router.push('/auth/signin')}
              className="mt-4"
            >
              Return to Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight">
            {isVerified ? 'Email Verified!' : 'Invalid Verification Link'}
          </h2>
          <p className="mt-2 text-center text-gray-600">
            {isVerified
              ? 'Your email has been verified. You can now sign in to your account.'
              : 'This verification link is invalid or has expired. Please try registering again.'}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="text-center">
          <Button
            id="return-to-signin-button"
            variant="outline"
            onClick={() => router.push('/auth/signin')}
            className="mt-4"
          >
            Return to Sign In
          </Button>
        </div>
      </div>
    </div>
  );
}
