'use client';

import React from 'react';
import AccountManagement from '@/empty/components/settings/account/AccountManagement';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function AccountPage() {
  const { t } = useTranslation('common');
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('pages.titles.accountManagement')}</h1>
      <AccountManagement />
    </div>
  );
}
