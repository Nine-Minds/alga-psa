'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** The provider status pill, shared by the chooser cards and the panels. */
export function TelephonyStatusBadge({ status, id }: { status: string; id?: string }) {
  const { t } = useTranslation('msp/integrations');

  if (status === 'active') {
    return <Badge id={id} variant="success">{t('integrations.telephony.status.active', { defaultValue: 'Active' })}</Badge>;
  }
  if (status === 'error') {
    return <Badge id={id} variant="error">{t('integrations.telephony.status.error', { defaultValue: 'Error' })}</Badge>;
  }
  if (status === 'disabled') {
    return <Badge id={id} variant="secondary">{t('integrations.telephony.status.disabled', { defaultValue: 'Disabled' })}</Badge>;
  }
  return <Badge id={id} variant="secondary">{t('integrations.telephony.status.notConfigured', { defaultValue: 'Not configured' })}</Badge>;
}

export default TelephonyStatusBadge;
