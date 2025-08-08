'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface PasswordResetWarningProps {
  className?: string;
}

export function PasswordResetWarning({ className = '' }: PasswordResetWarningProps) {
  return (
    <div className={`rounded-md bg-amber-50 border border-amber-200 p-4 ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-semibold text-amber-800">
            Password Change Required
          </h3>
          <div className="mt-1 text-sm text-amber-700">
            <p>You are still using a temporary password. Please change your password to secure your account.</p>
          </div>
        </div>
      </div>
    </div>
  );
}