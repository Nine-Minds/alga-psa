"use client";

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Alert, AlertDescription } from '@alga-psa/ui/components';
import { AlertCircle, LogOut, ArrowRight } from 'lucide-react';
// Same page, same constraint as MspSignIn: 'msp/auth' is still loading when
// this first renders, so suspense stays off and every key carries a
// defaultValue.
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('msp/auth', { useSuspense: false });
  const [isSwitching, setIsSwitching] = useState(false);

  const portalName = (portal: 'msp' | 'client') =>
    portal === 'msp'
      ? t('portalSwitch.mspPortal', 'MSP Portal')
      : t('portalSwitch.clientPortal', 'Client Portal');

  const currentPortalName = portalName(currentPortal);
  const targetPortalName = portalName(targetPortal);

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
    <div className="min-h-screen flex items-center justify-center auth-page-surface p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-warning/15 p-3">
              <AlertCircle className="h-8 w-8 text-warning" />
            </div>
          </div>
          <CardTitle className="text-2xl">
            {t('portalSwitch.title', 'Portal Switch Required')}
          </CardTitle>
          <CardDescription className="text-base mt-2">
            {/* The portal name is bold inside the sentence, so the sentence is
                split around it rather than interpolated — translators reorder
                clauses, and a raw <strong> in a JSON value cannot follow. */}
            <span>
              {t('portalSwitch.signedInToPrefix', "You're currently signed in to the ")}
              <strong>{currentPortalName}</strong>
              {t('portalSwitch.signedInToSuffix', '')}
            </span>
            {userEmail && <span className="block mt-1 text-sm">({userEmail})</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <AlertDescription>
              {t('portalSwitch.signOutRequiredPrefix', 'To access the ')}
              <strong>{targetPortalName}</strong>
              {t('portalSwitch.signOutRequiredSuffix', ', you need to sign out of your current session.')}
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
              {t('portalSwitch.continueTo', 'Continue to {{portal}}', { portal: currentPortalName })}
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
              {isSwitching
                ? t('portalSwitch.switching', 'Switching...')
                : t('portalSwitch.signOutAndSwitch', 'Sign Out and Switch to {{portal}}', {
                    portal: targetPortalName,
                  })}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground mt-4">
            {t(
              'portalSwitch.footnote',
              "Switching portals will sign you out of your current session. You'll need to sign in again with the appropriate credentials.",
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
