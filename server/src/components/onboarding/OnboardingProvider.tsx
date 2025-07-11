'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { OnboardingWizard } from './OnboardingWizard';
import { getTenantSettings, updateTenantOnboardingStatus, saveTenantOnboardingProgress } from '@/lib/actions/tenant-settings-actions/tenantSettingsActions';
import { getOnboardingInitialData } from '@/lib/actions/onboarding-actions/onboardingActions';
import { WizardData } from './types';

interface OnboardingProviderProps {
  children: React.ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { data: session, status } = useSession();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialData, setInitialData] = useState<Partial<WizardData>>({});
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);

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
      
      // Only show onboarding if both settings exist and are explicitly set to false
      // If settings don't exist or are incomplete, don't show onboarding wizard
      if (settings && 
          settings.hasOwnProperty('onboarding_completed') && 
          settings.hasOwnProperty('onboarding_skipped') &&
          !settings.onboarding_completed && 
          !settings.onboarding_skipped) {
        setShowOnboarding(true);
        
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
        setDataLoaded(true);
      } else {
        // Even if we're not showing onboarding, mark data as loaded
        setDataLoaded(true);
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingComplete = async (data: WizardData) => {
    try {
      // Mark onboarding as completed
      await updateTenantOnboardingStatus(true, data, false);
      setShowOnboarding(false);
      
      // Refresh the page to ensure all data is loaded
      window.location.reload();
    } catch (error) {
      console.error('Error completing onboarding:', error);
      alert('Failed to save onboarding data. Please try again.');
    }
  };

  const handleOnboardingClose = async () => {
    // For now, just close without skipping
    // Users can access it again from the menu
    setShowOnboarding(false);
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

  return (
    <>
      {children}
      {showOnboarding && dataLoaded && (
        <OnboardingWizard
          open={showOnboarding}
          onOpenChange={(open) => {
            if (!open) {
              handleOnboardingClose();
            }
          }}
          initialData={initialData}
          onComplete={handleOnboardingComplete}
          testMode={false}
          debugMode={process.env.NODE_ENV === 'development'}
        />
      )}
    </>
  );
}