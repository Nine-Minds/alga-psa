'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { getTenantSettings } from '@/lib/actions/tenant-settings-actions/tenantSettingsActions';
import { getOnboardingInitialData } from '@/lib/actions/onboarding-actions/onboardingActions';
import { WizardData } from '@/components/onboarding/types';

export default function OnboardingPage() {
  const router = useRouter();
  const [initialData, setInitialData] = useState<Partial<WizardData>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkOnboardingStatusAndLoadData();
  }, []);

  const checkOnboardingStatusAndLoadData = async () => {
    try {
      // Check if onboarding is already completed
      const settings = await getTenantSettings();
      
      if (settings?.onboarding_completed) {
        // Redirect to dashboard if onboarding is already completed
        router.push('/msp');
        return;
      }

      // Load any saved progress
      let data: Partial<WizardData> = {};
      
      if (settings?.onboarding_data) {
        data = settings.onboarding_data;
      }
      
      // Fetch current user and company info to prefill
      const initialDataResult = await getOnboardingInitialData();
      
      if (initialDataResult.success && initialDataResult.data) {
        // Merge with any existing saved data (saved data takes precedence)
        data = {
          ...initialDataResult.data,
          ...data
        };
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
      />
    </div>
  );
}