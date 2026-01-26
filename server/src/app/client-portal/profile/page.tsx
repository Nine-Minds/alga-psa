'use client';

import React from 'react';
import { ClientProfile } from '@alga-psa/client-portal/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ProfilePage() {
  const { t } = useTranslation('clientPortal');

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('profile.title')}</h1>
      <ClientProfile />
    </div>
  );
}
