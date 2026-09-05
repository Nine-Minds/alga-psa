'use client';

import { useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Dialog, DialogDescription, DialogFooter, Button } from '@alga-psa/ui/components';
import { usePostHog } from 'posthog-js/react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface SignOutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignOutDialog({ isOpen, onClose }: SignOutDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { data: session } = useSession();
  const posthog = usePostHog();
  const { t } = useTranslation('common');

  const handleSignOut = async () => {
    setIsLoading(true);
    
    // Track logout event and reset user
    if (posthog && session?.user) {
      posthog.capture('user_logged_out', {
        user_type: (session.user as any).user_type || 'unknown',
      });
      // Reset PostHog to clear user identification
      posthog.reset();
    }
    
    // Redirect to the general signin page which will redirect appropriately
    await signOut({ callbackUrl: '/auth/signin' });
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('auth.signOut.title')}
    >
      <DialogDescription>
        {t('auth.signOut.confirmation')}
      </DialogDescription>
      <DialogFooter>
        <Button
          id='cancel-button'
          variant="outline"
          onClick={onClose}
          disabled={isLoading}
        >
          {t('common.cancel')}
        </Button>
        <Button
          id='sign-out-button'
          onClick={handleSignOut}
          disabled={isLoading}
        >
          {isLoading ? t('auth.signOut.signingOut') : t('auth.signOut.action')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
