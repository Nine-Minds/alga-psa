'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';

interface PasswordResetWarningProps {
  className?: string;
}

export function PasswordResetWarning({ className = '' }: PasswordResetWarningProps) {
  return (
    <Alert variant="warning" className={className}>
      <AlertDescription>
        <h3 className="text-sm font-semibold">
          Password Change Required
        </h3>
        <p className="mt-1 text-sm">You are still using a temporary password. Please change your password to secure your account.</p>
      </AlertDescription>
    </Alert>
  );
}
