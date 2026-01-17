"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { recoverPassword } from 'server/src/lib/actions/useRegister';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ArrowLeft, Mail, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

const CheckEmailContent: React.FC = () => {
  const [isResending, setIsResending] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams!.get('email');
  const type = searchParams!.get('type');
  const portal = searchParams!.get('portal') || 'msp'; // Default to MSP if not specified

  const handleResend = async () => {
    if (!email) return;
    
    setIsResending(true);
    try {
      await recoverPassword(email, portal as 'msp' | 'client');
      toast.success('Email sent! Please check your inbox.');
    } catch (error) {
      toast.error('Failed to resend email. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToSignIn = () => {
    router.push(portal === 'client' ? '/auth/client-portal/signin' : '/auth/msp/signin');
  };

  const themeColor = portal === 'client' ? 'blue' : 'purple';
  const bgGradient = portal === 'client' 
    ? 'bg-gradient-to-br from-blue-50 to-indigo-100' 
    : 'bg-gradient-to-br from-purple-50 via-purple-100 to-indigo-100';

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${bgGradient}`}>
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">

          {/* Title */}
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2 flex items-center justify-center gap-2">
            <Mail className="w-6 h-6" />
            Check Your Email
          </h2>
          <p className="text-gray-600 text-center mb-6">
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
            <div className="p-4 bg-purple-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2 text-purple-900">What's next?</h4>
              <ol className="text-sm text-purple-700 space-y-1">
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
                <h4 className="font-medium text-sm mb-2">Didn't receive the email?</h4>
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

const CheckEmail: React.FC = () => {
    return (
        <Suspense fallback={<div>Loading...</div>}>
        <CheckEmailContent />
        </Suspense>
    );
};

export default CheckEmail;