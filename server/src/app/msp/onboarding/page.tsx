'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingWizard } from '@alga-psa/onboarding/components';
import { getTenantSettings } from '@alga-psa/tenancy/actions';
import { getOnboardingInitialData } from '@alga-psa/onboarding/actions';
import type { WizardData } from '@alga-psa/types';

export default function OnboardingPage() {
  const router = useRouter();
  const [initialData, setInitialData] = useState<Partial<WizardData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRevisit, setIsRevisit] = useState(false);

  useEffect(() => {
    checkOnboardingStatusAndLoadData();
  }, []);

  const checkOnboardingStatusAndLoadData = async () => {
    try {
      // Load tenant settings
      const settings = await getTenantSettings();

      // Check if this is a revisit (onboarding was previously completed)
      const isReturningUser = settings?.onboarding_completed || false;
      setIsRevisit(isReturningUser);

      // Load any saved progress
      let data: Partial<WizardData> = {};

      if (settings?.onboarding_data) {
        data = settings.onboarding_data;
      }

      // For first-time users, fetch user data to prefill
      // For returning users, only fetch company/tenant data
      if (!isReturningUser) {
        const initialDataResult = await getOnboardingInitialData();

        if (initialDataResult.success && initialDataResult.data) {
          // Merge saved progress with current user data
          // IMPORTANT: User-specific fields (firstName, lastName, email) must always come from
          // the current user's session, NOT from saved tenant-wide data which could contain
          // another user's info if they previously used the wizard
          const { firstName: _f, lastName: _l, email: _e, ...savedNonUserData } = data;
          data = {
            ...savedNonUserData,        // Saved progress (client info, team members, etc.)
            ...initialDataResult.data,  // Current user's identity always takes precedence
          };
        }
      } else {
        // For returning users, just prefill company name from tenant data
        const initialDataResult = await getOnboardingInitialData();
        if (initialDataResult.success && initialDataResult.data?.clientName) {
          data = {
            ...data,
            clientName: initialDataResult.data.clientName
          };
        }
      }

      setInitialData(data);
    } catch (error) {
      console.error('Error loading onboarding data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleComplete = async () => {
    // After successful completion, redirect to main dashboard
    router.push('/msp');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <OnboardingWizard
        initialData={initialData}
        onComplete={handleComplete}
        fullPage={true}
        isRevisit={isRevisit}
      />
    </div>
  );
}
