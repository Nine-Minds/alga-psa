"use client";
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@alga-psa/ui/components/Button';

const PasswordResetConfirmation: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portal = searchParams?.get('portal') || 'msp';

  const handleContinue = () => {
    router.push(portal === 'client' ? '/auth/client-portal/signin' : '/auth/msp/signin'); 
  };

  return (
    <div className="flex flex-col items-center p-20 min-h-screen bg-white">
      <div className="w-full max-w-md p-8 space-y-8 text-center">
        <div>
          <Image
            src="/images/avatar-purple-background.png"
            alt="Logo"
            width={60}
            height={60}
            className="mx-auto rounded-full"
          />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Password reset</h2>
        <p className="text-sm text-gray-600">
          Your password has been successfully reset.
          <br />
          Click below to sign in with your new password.
        </p>
        <Button
          id="proceed-to-sign-in-btn"
          variant="default"
          onClick={handleContinue}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-[rgb(var(--color-primary-600))] rounded-md hover:bg-[rgb(var(--color-primary-700))] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[rgb(var(--color-primary-500))]"
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default PasswordResetConfirmation;