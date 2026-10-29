'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Shown when a scanned/deep-linked record is missing, in another tenant, or denied.
 * Deliberately takes no record props: a denied record must not leak any content, and
 * "missing" and "denied" are indistinguishable by design.
 */
export function RecordUnavailable({ id = 'record-unavailable' }: { id?: string }) {
  const { t } = useTranslation('features/inventory');
  return (
    <p id={id} className="p-4 text-sm text-gray-600" role="alert">
      {t('common.recordUnavailable', "Not found, or you don't have access")}
    </p>
  );
}

export default RecordUnavailable;
