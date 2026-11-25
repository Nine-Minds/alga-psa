'use client';

import React from 'react';
import UserProfile from '@/components/settings/profile/UserProfile';
import { DashboardOnboardingSectionPreference } from '@alga-psa/onboarding/components';
import { useProduct } from '@/context/ProductContext';
import { surfaceAllowsProfileSection, PROFILE_ONBOARDING_PREFERENCE } from '@shared/services/productSurfaceKinds';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ProfilePage() {
  const { t } = useTranslation('msp/settings');
  const { surfaceKind } = useProduct();
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('profile.pageTitle')}</h1>
      <UserProfile />
      {surfaceAllowsProfileSection(surfaceKind, PROFILE_ONBOARDING_PREFERENCE) && <DashboardOnboardingSectionPreference />}
    </div>
  );
}
