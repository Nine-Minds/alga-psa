'use client';

/**
 * CE Stub for Account Management Page
 * In CE builds, this page shows a placeholder
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import AccountManagement from '../../../components/settings/account/AccountManagement';

export default function AccountPage() {
  const { t } = useTranslation('msp/account');

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">{t('page.title')}</h1>
      <AccountManagement />
    </div>
  );
}
