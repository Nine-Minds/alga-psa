"use client";

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Alert, AlertDescription } from '@alga-psa/ui/components';
import { AlertCircle, LogOut, ArrowRight } from 'lucide-react';

interface PortalSwitchPromptProps {
  currentPortal: 'msp' | 'client';
  targetPortal: 'msp' | 'client';
  currentPortalUrl: string;
  targetPortalSigninUrl: string;
  userEmail?: string;
}

export default function PortalSwitchPrompt({
  currentPortal,
  targetPortal,
  currentPortalUrl,
  targetPortalSigninUrl,
  userEmail,
}: PortalSwitchPromptProps) {
  const [isSwitching, setIsSwitching] = useState(false);

  const currentPortalName = currentPortal === 'msp' ? 'MSP Portal' : 'Client Portal';
  const targetPortalName = targetPortal === 'msp' ? 'MSP Portal' : 'Client Portal';

  const handleSwitch = async () => {
    setIsSwitching(true);
    try {
      // Sign out and redirect to target portal signin
      await signOut({
        redirect: true,
        callbackUrl: targetPortalSigninUrl
      });
    } catch (error) {
      console.error('Error switching portals:', error);
      setIsSwitching(false);
    }
  };

  const handleStay = () => {
    window.location.href = currentPortalUrl;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F8FFFE] to-[#F0F9FF] dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/20 p-3">
              <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-500" />
            </div>
          </div>
          <CardTitle className="text-2xl">Portal Switch Required</CardTitle>
          <CardDescription className="text-base mt-2">
            You're currently signed in to the <strong>{currentPortalName}</strong>
            {userEmail && <span className="block mt-1 text-sm">({userEmail})</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <AlertDescription>
              To access the <strong>{targetPortalName}</strong>, you need to sign out of your current session.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <Button
              id="stay-in-current-portal"
              variant="default"
              size="lg"
              className="w-full"
              onClick={handleStay}
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              Continue to {currentPortalName}
            </Button>

            <Button
              id="switch-portal"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={handleSwitch}
              disabled={isSwitching}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {isSwitching ? 'Switching...' : `Sign Out and Switch to ${targetPortalName}`}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground mt-4">
            Switching portals will sign you out of your current session.
            You'll need to sign in again with the appropriate credentials.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
