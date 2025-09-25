'use client';

import React from 'react';
import { ClientProfile } from 'server/src/components/client-portal/profile/ClientProfile';
import { useTranslation } from 'server/src/lib/i18n/client';

export default function ProfilePage() {
  const { t } = useTranslation('clientPortal');

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('profile.title')}</h1>
      <ClientProfile />
    </div>
  );
}
