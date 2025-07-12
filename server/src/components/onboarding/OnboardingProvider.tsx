'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { getTenantSettings } from '@/lib/actions/tenant-settings-actions/tenantSettingsActions';

interface OnboardingProviderProps {
  children: React.ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      checkOnboardingStatus();
    } else if (status === 'unauthenticated') {
      setLoading(false);
    }
  }, [status, session]);

  const checkOnboardingStatus = async () => {
    try {
      const settings = await getTenantSettings();
      
      // Skip check if already on onboarding page
      if (pathname === '/msp/onboarding') {
        setLoading(false);
        return;
      }
      
      // Redirect to onboarding if not completed and not skipped
      if (settings && 
          settings.hasOwnProperty('onboarding_completed') && 
          settings.hasOwnProperty('onboarding_skipped') &&
          !settings.onboarding_completed && 
          !settings.onboarding_skipped) {
        router.push('/msp/onboarding');
        return;
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
    } finally {
      setLoading(false);
    }
  };

  // Don't block rendering while checking onboarding status
  if (loading && status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}