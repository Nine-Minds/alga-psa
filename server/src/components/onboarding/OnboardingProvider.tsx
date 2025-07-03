'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { OnboardingWizard } from './OnboardingWizard';
import { getTenantSettings, updateTenantOnboardingStatus, saveTenantOnboardingProgress } from '@/lib/actions/tenant-settings-actions/tenantSettingsActions';
import { WizardData } from './types';

interface OnboardingProviderProps {
  children: React.ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { data: session, status } = useSession();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialData, setInitialData] = useState<Partial<WizardData>>({});
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
      
      // TODO: Only show onboarding for admin users
      // Need to fetch user roles separately as they're not in the session
      const isAdmin = false; // Temporarily disabled - onboarding feature not ready
      
      if (settings && !settings.onboarding_completed && !settings.onboarding_skipped && isAdmin) {
        setShowOnboarding(true);
        
        // Load any saved progress
        if (settings.onboarding_data) {
          setInitialData(settings.onboarding_data);
        }
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
      {showOnboarding && (
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