'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from 'server/src/components/ui/Button';
import { useTranslation } from 'server/src/lib/i18n/client';

export function SwitchToMSPButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation('clientPortal');

  const handleSwitchToMSP = async () => {
    setIsLoading(true);
    try {
      // Sign out the current client portal user and redirect to MSP signin
      await signOut({
        callbackUrl: '/auth/msp/signin',
        redirect: true,
      });
    } catch (error) {
      console.error('Error signing out:', error);
      setIsLoading(false);
    }
  };

  return (
    <Button
      id="go-to-msp-portal-btn"
      onClick={handleSwitchToMSP}
      disabled={isLoading}
    >
      {isLoading ? t('account.licenseManagement.signingOut') : t('account.licenseManagement.goToMSPPortal')}
    </Button>
  );
}
